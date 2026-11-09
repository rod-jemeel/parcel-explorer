"""Join counted borough snapshots into an immutable SQLite release."""
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
from functools import partial
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

from services.ingestion.brooklyn_fetch import STAGE, DATASETS, rows
from services.ingestion.domain import (
    MAP_URL, normalize_bbl, normalize_document, normalize_feature,
    normalize_permit, normalize_sale, publish_release,
)
from services.ingestion.import_pilot import PUBLIC, ROOT, write_json
from services.ingestion.nyc_buildings import normalize_building, URL, IMAGERY_URL

VERSION = 'brooklyn-sqlite/1'


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


class Features:
    """Write a feature collection incrementally without retaining geometry in memory."""

    def __init__(self, path):
        self.stream = path.open('w', encoding='utf-8')
        self.stream.write('{"type":"FeatureCollection","features":[')
        self.count = 0

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.stream.write(']}')
        self.stream.close()

    def add(self, geometry, properties):
        if self.count:
            self.stream.write(',')
        self.stream.write(encoded({'type': 'Feature', 'geometry': geometry, 'properties': properties}))
        self.count += 1


def snapshot(name):
    return json.loads((STAGE / f'{name}.json').read_text(encoding='utf-8'))


def init(db):
    db.executescript("""
        PRAGMA journal_mode=DELETE;
        PRAGMA synchronous=OFF;
        PRAGMA cache_size=-131072;
        PRAGMA temp_store=MEMORY;
        CREATE TABLE parcel(
          bbl TEXT PRIMARY KEY, address TEXT NOT NULL, land_use TEXT, lot REAL,
          year INTEGER, assessment REAL, west REAL, south REAL, east REAL, north REAL,
          payload TEXT NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE buildings(
          id TEXT PRIMARY KEY, bbl TEXT NOT NULL, payload TEXT NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE event(
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, payload TEXT NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE link(
          bbl TEXT NOT NULL, event TEXT NOT NULL, kind TEXT NOT NULL, event_date TEXT NOT NULL,
          PRIMARY KEY(bbl,event)
        ) WITHOUT ROWID;
    """)


def insert_event(db, record, known, release):
    matched = set(record['property_bbls']).intersection(known)
    if not matched:
        return False
    record['release_id'] = release
    db.execute('INSERT OR IGNORE INTO event VALUES(?,?,?,?)',
               (record['id'], record['type'], record['source'], encoded(record)))
    date = record.get('date') or record.get('recording_date') or ''
    db.executemany('INSERT OR IGNORE INTO link VALUES(?,?,?,?)',
                   ((bbl, record['id'], record['type'], date) for bbl in matched))
    return True


def parcel_import(db, source, release, path):
    known = set()
    bounds = [180, 90, -180, -90]
    versions = set()
    condos = 0
    with Features(path) as features:
        for raw in rows(source):
            profile = normalize_feature(raw)
            bbl = profile['bbl']
            if bbl in known:
                raise ValueError(f'Duplicate parcel identity: {bbl}')
            known.add(bbl)
            profile['release_id'] = release
            west, south, east, north = profile['bounds']
            bounds = [min(bounds[0], west), min(bounds[1], south),
                      max(bounds[2], east), max(bounds[3], north)]
            versions.add(profile['source_edition'] or 'Unknown')
            condos += profile['entity_kind'] == 'billing_group'
            db.execute('INSERT INTO parcel VALUES(?,?,?,?,?,?,?,?,?,?,?)', (
                bbl, profile['address'].strip().upper(), profile['land_use'], profile['lot_area'],
                profile['year_built'], profile['assess_total'], *profile['bounds'], encoded(profile),
            ))
            features.add(raw['geometry'], {'bbl': bbl, 'lot': profile['lot'],
                         'block': profile['block'], 'use': profile['land_use'] or '',
                         'kind': profile['entity_kind']})
    if len(known) != source['count']:
        raise ValueError('MapPLUTO snapshot count mismatch')
    db.commit()
    return known, bounds, ', '.join(sorted(versions)), condos


def building_import(db, source, known, path):
    sys.path.insert(0, str(ROOT / 'data' / 'brooklyn-deps'))
    from shapely import from_wkt
    from shapely.geometry import mapping

    with Features(path) as features:
        for row in rows(source):
            record = normalize_building(row, known)
            if not record or not record['geometry']:
                continue
            geometry = from_wkt(record['geometry'])
            if geometry.is_empty:
                continue
            record['geometry'] = mapping(geometry)
            db.execute('INSERT INTO buildings VALUES(?,?,?)',
                       (record['id'], record['bbl'], encoded(record)))
            features.add(record['geometry'], {'id': record['id'], 'bbl': record['bbl'],
                                             'bin': record['bin'] or ''})
    db.execute('CREATE INDEX building_parcel ON buildings(bbl)')
    db.commit()
    return features.count


def document_import(db, sources, known, release):
    # Keep all source associations for a Brooklyn-linked document, even when another
    # lot is outside the borough. The amount remains at the document level.
    db.execute('CREATE TABLE legal(doc TEXT, bbl TEXT, PRIMARY KEY(doc,bbl)) WITHOUT ROWID')
    wanted = set()
    for row in rows(sources['legals']):
        try:
            bbl = normalize_bbl(row['borough'], row['block'], row['lot'])
        except (ValueError, KeyError):
            continue
        doc = row['document_id']
        db.execute('INSERT OR IGNORE INTO legal VALUES(?,?)', (doc, bbl))
        if bbl in known:
            wanted.add(doc)
    db.commit()
    for row in rows(sources['master']):
        doc = row['document_id']
        if doc not in wanted:
            continue
        legals = [{'borough': bbl[:1], 'block': bbl[1:6], 'lot': bbl[6:]}
                  for (bbl,) in db.execute('SELECT bbl FROM legal WHERE doc=?', (doc,))]
        record = normalize_document(row, legals)
        if record:
            record['raw_record_hash'] = hashlib.sha256(encoded(row).encode()).hexdigest()
            insert_event(db, record, known, release)
    db.execute('DROP TABLE legal')
    db.commit()


def retain_prior_history(db, known, release, prior):
    """Retain the verified older backfills and existing records absent from fresh feeds."""
    previous = ROOT / 'data' / 'releases' / prior['release_id']

    def records():
        if prior.get('storage_format') == 'sqlite-v1':
            path = previous / 'brooklyn.sqlite'
            with closing(sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)) as old:
                for (payload,) in old.execute('SELECT payload FROM event'):
                    yield json.loads(payload)
            return
        archive = previous / 'records.json'
        if archive.exists():
            yield from json.loads(archive.read_text(encoding='utf-8'))

    for record in records():
        if db.execute('SELECT 1 FROM event WHERE id=?', (record['id'],)).fetchone():
            continue
        insert_event(db, record, known, release)


def make_release():
    names = ['parcels', *DATASETS]
    sources = {name: snapshot(name) for name in names}
    prior = json.loads((PUBLIC / 'coverage.json').read_text(encoding='utf-8'))
    identity = [VERSION, prior['release_id'], [(name, s['revision'], s['count']) for name, s in sources.items()]]
    digest = hashlib.sha256(encoded(identity).encode()).hexdigest()
    release = 'bk-' + digest[:12]
    private = ROOT / 'data' / 'releases' / release
    private.mkdir(parents=True, exist_ok=True)
    db_path = private / 'brooklyn.sqlite'
    if db_path.exists():
        raise FileExistsError(f'Release already prepared: {release}')
    pending = private / 'brooklyn.pending.sqlite'
    pending.unlink(missing_ok=True)
    with sqlite3.connect(pending) as db:
        db.execute('PRAGMA mmap_size=2147418112')
        init(db)
        known, bounds, edition, condos = parcel_import(db, sources['parcels'], release, private / 'geometry.geojson')
        print(f'Validated {len(known):,} parcel identities', flush=True)
        buildings = building_import(db, sources['buildings'], known, private / 'buildings.geojson')
        print(f'Linked {buildings:,} building footprints', flush=True)
        skipped = Counter()
        for name in ('dob_bis', 'dob_now', 'sales'):
            parser = normalize_sale if name == 'sales' else partial(normalize_permit, source=name)
            for row in rows(sources[name]):
                if name == 'sales':
                    row = {key: value for key, value in row.items()
                           if key != 'source_row_id' and value != ''}
                try:
                    record = parser(row)
                except (ValueError, KeyError):
                    skipped[name] += 1
                    continue
                record['raw_record_hash'] = hashlib.sha256(encoded(row).encode()).hexdigest()
                if not insert_event(db, record, known, release):
                    skipped[name] += 1
            db.commit()
            print(f'Joined {name}', flush=True)
        document_import(db, sources, known, release)
        print('Joined ACRIS document metadata and property associations', flush=True)
        retain_prior_history(db, known, release, prior)
        db.executescript("""
            CREATE INDEX history_all ON link(bbl,event_date DESC,event DESC);
            CREATE INDEX history_kind ON link(bbl,kind,event_date DESC,event DESC);
            CREATE TABLE stats AS
            SELECT bbl,count(*) AS total, sum(kind='document') AS document,
                   sum(kind='permit') AS permit, sum(kind='transfer') AS transfer,
                   max(CASE WHEN kind='transfer' THEN event_date END) AS latest_transfer
            FROM link GROUP BY bbl;
            CREATE UNIQUE INDEX stats_parcel ON stats(bbl);
            CREATE INDEX parcel_address ON parcel(address,bbl);
            CREATE INDEX parcel_west ON parcel(west);
            ANALYZE;
        """)
        counts = dict(db.execute('SELECT source,count(*) FROM event GROUP BY source'))
        multi = db.execute("SELECT count(*) FROM event WHERE kind='document' AND json_array_length(payload,'$.property_bbls')>1").fetchone()[0]
        db.commit()
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite validation failed')
    db.close()
    pending.replace(db_path)

    write_candidate(release, digest, private, sources, len(known), bounds, edition, condos, buildings, counts, multi, skipped)


def write_candidate(release, digest, private, sources, parcel_count, bounds, edition, condos,
                    buildings, counts, multi, skipped):
    coverage = [
        {'id': 'mappluto', 'name': 'MapPLUTO parcels', 'url': MAP_URL, 'status': 'imported',
         'linked_records': parcel_count, 'source_edition': edition,
         'note': 'All Brooklyn tax-lot footprints in the MapPLUTO snapshot.'},
        {'id': 'oti_buildings', 'name': 'OTI building footprints', 'url': URL, 'status': 'imported',
         'linked_records': buildings, 'source_rows': sources['buildings']['count'],
         'note': 'Linked by published MapPLUTO or base BBL. Footprints without a matched tax lot are excluded.'},
        {'id': 'acris', 'name': 'ACRIS recorded documents', 'url': 'https://www.nyc.gov/site/finance/property/acris.page',
         'status': 'partial', 'linked_records': counts.get('acris', 0), 'date_basis': 'recording_date',
         'imported_from': '2016-01-01',
         'note': 'Borough-wide exact-BBL joins for 2016-onward master records with numeric document IDs from 2016 onward. Previously imported older records are retained. Historic lots and condo units may require separate research.'},
        {'id': 'nyc_aerial_2024', 'name': 'NYC 2024 aerial imagery', 'url': IMAGERY_URL,
         'source_edition': '2024', 'status': 'available', 'note': 'Live tiles from NYC OTI.'},
    ]
    for name, title, event_source in (
        ('dob_bis', 'DOB BIS building permits', 'dob_bis'),
        ('dob_now', 'DOB NOW approved permits', 'dob_now'),
        ('sales', 'DOF rolling sales', 'dof_sales'),
    ):
        s = sources[name]
        coverage.append({'id': event_source, 'name': title, 'url': 'https://data.cityofnewyork.us/d/'+s['dataset'],
                         'status': 'imported', 'source_rows': s['count'], 'linked_records': counts.get(event_source, 0),
                         'note': (f'{skipped[name]:,} source rows were invalid or had no matching BBL. ' if skipped is not None
                                  else 'Rows link by exact BBL. ')
                                 + 'Prior imported records are retained. ' + ('The current DOF rolling feed covers recent sales.' if name == 'sales' else 'Statuses reflect the source observations.')})
    manifest = {
        'release_id': release, 'storage_format': 'sqlite-v1', 'parser_version': VERSION,
        'fetched_at': datetime.now(timezone.utc).isoformat(), 'snapshot_identity_sha256': digest,
        'expected_features': parcel_count, 'feature_count': parcel_count, 'entity_count': parcel_count,
        'area_name': 'Brooklyn, Kings County', 'jurisdiction': 'brooklyn', 'bounds': bounds,
        'source_edition': edition, 'sources': coverage, 'building_footprints': buildings,
        'record_count': sum(counts.values()), 'condo_footprints': condos, 'multi_property_documents': multi,
        'limitations': ['Exact tax-lot joins can miss historical lot changes and condo units.',
                        'ACRIS joins have the date and document ID limits listed in Sources.',
                        'DOF sales use the rolling feed. Older deeds can appear under ACRIS.'],
    }
    write_json(private / 'snapshots.json', sources)
    write_json(PUBLIC / release / 'manifest.json', manifest)
    write_json(ROOT / 'data' / 'candidate.json', manifest)
    print(f'Prepared {release}: {parcel_count:,} parcels, {buildings:,} footprints, {sum(counts.values()):,} records', flush=True)


def publish():
    manifest = json.loads((ROOT / 'data' / 'candidate.json').read_text(encoding='utf-8'))
    release = manifest['release_id']
    tiles = json.loads((PUBLIC / release / 'tiles-ready.json').read_text(encoding='utf-8'))
    if (manifest.get('storage_format') != 'sqlite-v1' or not tiles['count']
            or tiles['release_id'] != release or tiles['features'] != manifest['feature_count']):
        raise ValueError('Build tiles for the borough candidate before publishing')
    prior = json.loads((PUBLIC / 'coverage.json').read_text(encoding='utf-8'))
    if (manifest['feature_count'] < prior['feature_count'] * .95
            or manifest['record_count'] < prior['record_count'] * .8):
        raise ValueError('Unexpected coverage drop; review the candidate before publishing')
    path = ROOT / 'data' / 'releases' / release / 'brooklyn.sqlite'
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
        db.execute('PRAGMA mmap_size=2147418112')
        actual = db.execute('SELECT count(*) FROM parcel').fetchone()[0]
        if db.execute('SELECT count(*) FROM buildings').fetchone()[0] != manifest['building_footprints']:
            raise ValueError('Building count mismatch')
        event_sources = {}
        for source, count, first, last in db.execute("""
            SELECT source,count(*),min(event_day),max(event_day)
            FROM (
                SELECT source,NULLIF(COALESCE(json_extract(payload,'$.recording_date'),
                                             json_extract(payload,'$.date')), '') AS event_day
                FROM event
            ) GROUP BY source
        """):
            event_sources[source] = (count, first, last)
    if sum(count for count, *_ in event_sources.values()) != manifest['record_count']:
        raise ValueError('Record count mismatch')
    date_bases = {'acris': 'recording_date', 'dob_bis': 'permit_issuance_date',
                  'dob_now': 'permit_issuance_date', 'dof_sales': 'sale_date'}
    source_metadata = {source['id']: source for source in manifest['sources']}
    for name, basis in date_bases.items():
        count, first, last = event_sources.get(name, (0, None, None))
        source = source_metadata[name]
        if not count or count != source['linked_records']:
            raise ValueError(f'Missing or inconsistent source: {name}')
        source.update(date_basis=basis, imported_from=first, through=last)
    source_metadata['acris']['requested_from'] = '2016-01-01'
    write_json(PUBLIC / release / 'manifest.json', manifest)
    publish_release(PUBLIC, manifest, expected_count=manifest['feature_count'], actual_count=actual)
    print('Published '+release, flush=True)


if __name__ == '__main__':
    publish() if '--publish' in sys.argv else make_release()
