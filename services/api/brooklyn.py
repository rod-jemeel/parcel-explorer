"""Bounded read queries for a published Brooklyn SQLite release."""
import json
import math
import re
from urllib.parse import parse_qs

PLACES = {'brooklyn', 'kings county', 'brooklyn ny'}
OUTSIDE = re.compile(r'\b(new jersey|jersey city|hudson|manhattan|queens|bronx|staten island|hoboken|newark|albany)\b', re.I)
BBL = re.compile(r'3\d{9}')
PROJECTION = 'p.payload, s.total, s.document, s.transfer, s.permit, s.latest_transfer'
PARCELS = 'FROM parcel p LEFT JOIN stats s USING(bbl)'


def summary(row):
    profile = json.loads(row[0])
    profile['record_count'] = row[1] or 0
    profile['history_counts'] = dict(zip(('all', 'document', 'transfer', 'permit'),
                                         (value or 0 for value in row[1:5])))
    profile['latest_imported_transfer'] = row[5] or None
    return profile


def property_profile(db, bbl):
    row = db.execute(f'SELECT {PROJECTION} {PARCELS} WHERE bbl=?', (bbl,)).fetchone()
    if row is None:
        return None
    profile = summary(row)
    buildings = [json.loads(payload) for (payload,) in
                 db.execute('SELECT payload FROM buildings WHERE bbl=? ORDER BY id', (bbl,))]
    bins = {r['bin'] for r in buildings if r['bin']}
    reported = profile['buildings']
    count_known = bool(buildings) and all(r['bin'] for r in buildings) and reported is not None
    profile['building_records'] = buildings
    profile['building_crosscheck'] = {
        'footprints': len(buildings), 'distinct_bins': len(bins),
        'pluto_reported_buildings': reported,
        'status': ('count_agrees' if reported == len(bins) else 'count_differs') if count_known else 'unresolved',
        'note': 'Exact official BBL association. Source editions can differ.',
    }
    return profile


def history(db, release, bbl, kind, page, *, limit=40, offset=None):
    column = {'all': 'total', 'document': 'document', 'permit': 'permit', 'transfer': 'transfer'}[kind]
    count = db.execute(f'SELECT {column} FROM stats WHERE bbl=?', (bbl,)).fetchone()
    total = count[0] if count else 0
    where = 'l.bbl=?' if kind == 'all' else 'l.bbl=? AND l.kind=?'
    args = (bbl,) if kind == 'all' else (bbl, kind)
    events = db.execute(f'''SELECT e.payload FROM link l JOIN event e ON l.event=e.id
        WHERE {where} ORDER BY l.event_date DESC,l.event DESC LIMIT ? OFFSET ?''',
        (*args, limit, page * 40 if offset is None else offset))
    return {'release_id': release, 'bbl': bbl, 'events': [json.loads(row[0]) for row in events],
            'total': total, 'next_page': page + 1 if (page + 1) * 40 < total else None}


def search(db, query):
    def get(key, default=''):
        return query.get(key, [default])[0]

    raw = get('q')[:200].strip()
    q = ' '.join(re.sub(r'[.,]', ' ', raw.upper()).split())
    place = q.lower() in PLACES
    if not place and not BBL.fullmatch(q) and OUTSIDE.fullmatch(raw):
        if get('matches') == '1':
            return []
        return {'results': [], 'total': 0, 'status': 'outside_coverage', 'isPlace': False}
    filters = json.loads(get('filters', '{}'))
    if not isinstance(filters, dict):
        raise ValueError('Invalid filters')
    predicates, args = [], []
    if q and not place:
        if BBL.fullmatch(q):
            predicates.append('p.bbl=?')
            args.append(q)
        else:
            house, _, street = q.partition(' ')
            if house.isascii() and house.isdigit() and street:
                predicates.extend(('p.address>=?', 'p.address<?'))
                args.extend((house + ' ', house + '!'))
                q_words = street.split()
            else:
                q_words = q.split()
            for word in q_words:
                predicates.append('instr(p.address,?)>0')
                args.append(word)
    uses = filters.get('uses', [])
    if not isinstance(uses, list) or len(uses) > 11 or any(str(use) not in {str(n) for n in range(1, 12)} for use in uses):
        raise ValueError('Invalid land uses')
    if uses:
        predicates.append('p.land_use IN (' + ','.join('?' for _ in uses) + ')')
        args.extend(uses)
    for key, column, operator in (
        ('minLot','lot','>='),('maxLot','lot','<='),('minYear','year','>='),('maxYear','year','<='),
        ('minAssessment','assessment','>='),('maxAssessment','assessment','<='),
    ):
        value = filters.get(key)
        if value is None:
            continue
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            raise ValueError('Invalid numeric filter')
        condition = f'p.{column}{operator}?'
        predicates.append(f'({condition} OR p.{column} IS NULL)' if filters.get('includeUnknown') else condition)
        args.append(value)
    if filters.get('hasRecords'):
        predicates.append('s.total>0')
    if get('bounds'):
        bounds = [float(value) for value in get('bounds').split(',')]
        if len(bounds) != 4 or not (-180 <= bounds[0] < bounds[2] <= 180 and -90 <= bounds[1] < bounds[3] <= 90):
            raise ValueError('Invalid bounds')
        predicates.extend(('p.east>=?', 'p.north>=?', 'p.west<=?', 'p.south<=?'))
        args.extend(bounds)
    where = ' WHERE ' + ' AND '.join(predicates) if predicates else ''
    base = PARCELS if filters.get('hasRecords') else 'FROM parcel p'
    if get('matches') == '1':
        if not get('bounds'):
            raise ValueError('Map matches require viewport bounds')
        return [row[0] for row in db.execute(f'SELECT p.bbl {base}{where}', args)]
    total = db.execute(f'SELECT count(*) {base}{where}', args).fetchone()[0]
    sort = get('sort', 'relevance')
    order = {'lot_desc': 'p.lot DESC,', 'assessment_desc': 'p.assessment DESC,'}.get(sort, '')
    rank_args = []
    if sort == 'relevance' and q and not place:
        order = 'CASE WHEN p.address=? THEN 0 WHEN substr(p.address,1,length(?))=? THEN 1 ELSE 2 END,'
        rank_args = [q, q, q]
    limit = max(1, min(int(get('limit', '40')), 2000))
    offset = max(0, min(int(get('offset', '0')), 1000000))
    # Rank parcel IDs first so searches over the address index only read full
    # profiles for the visible page.
    ordering = f'{order} p.address,p.bbl'
    results = db.execute(f"""
        WITH page AS MATERIALIZED (
            SELECT p.bbl {base}{where} ORDER BY {ordering} LIMIT ? OFFSET ?
        )
        SELECT {PROJECTION}
        FROM page JOIN parcel p USING(bbl) LEFT JOIN stats s USING(bbl)
        ORDER BY {ordering}
    """, (*args, *rank_args, limit, offset, *rank_args))
    return {'results': [summary(row) for row in results], 'total': total, 'status': 'ok', 'isPlace': place}


def sale_distance(origin, destination):
    lon1, lat1 = map(math.radians, origin)
    lon2, lat2 = map(math.radians, destination)
    arc = math.sin((lat2 - lat1) / 2) ** 2
    arc += math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 3958.76 * 2 * math.asin(math.sqrt(min(arc, 1)))


def comparable_sales(db, bbl):
    subject = property_profile(db, bbl)
    if not subject:
        return None
    size = subject.get('building_area')
    building_class = subject.get('building_class')
    if subject['entity_kind'] != 'parcel' or not size or size < 0 or not building_class:
        return {'sales': [], 'eligible': False}
    lon, lat = subject['center']
    # Coarse box for SQL, followed by exact center-to-center distance.
    rows = db.execute("""
        SELECT p.bbl, p.payload, e.payload
        FROM parcel p JOIN stats s USING(bbl)
        JOIN link l USING(bbl) JOIN event e ON e.id=l.event
        WHERE p.west <= ? AND p.east >= ? AND p.south <= ? AND p.north >= ?
          AND p.bbl != ? AND s.transfer > 0 AND l.kind='transfer' AND e.source='dof_sales'
    """, (lon + .020, lon - .020, lat + .015, lat - .015, bbl))
    sales = []
    for candidate_bbl, candidate_payload, sale_payload in rows:
        candidate = json.loads(candidate_payload)
        area = candidate.get('building_area') or 0
        if (candidate['entity_kind'] != 'parcel' or candidate.get('building_class') != building_class
                or not .5 * size <= area <= 1.5 * size):
            continue
        distance = sale_distance(subject['center'], candidate['center'])
        if distance > 1:
            continue
        sale = json.loads(sale_payload)
        if (not sale.get('date') or not sale.get('amount') or float(sale['amount']) <= 0
                or (sale.get('apartment') or '').strip() or sale['property_bbls'] != [candidate_bbl]):
            continue
        sales.append({'bbl': candidate_bbl, 'address': candidate['address'], 'building_area': area,
                      'distance': distance, 'sale': sale})
    # Keep the most recent eligible sale per lot, then present nearest first.
    latest = {}
    for item in sorted(sales, key=lambda item: (item['sale']['date'], item['sale']['id']), reverse=True):
        latest.setdefault(item['bbl'], item)
    return {'sales': sorted(latest.values(), key=lambda item: (item['distance'], item['bbl']))[:8],
            'eligible': True}


def route(db, release, path, raw_query):
    query = parse_qs(raw_query)
    match = re.fullmatch(r'profiles/(3\d{9})\.json', path)
    if match:
        return property_profile(db, match[1])
    match = re.fullmatch(r'history/(3\d{9})/(all|document|permit|transfer)/(\d{1,6})\.json', path)
    if match:
        return history(db, release, match[1], match[2], int(match[3]))
    match = re.fullmatch(r'comps/(3\d{9})\.json', path)
    if match:
        return comparable_sales(db, match[1])
    if path == 'search.json':
        return search(db, query)
    if path == 'summaries.json':
        ids = list(dict.fromkeys(query.get('bbl', [])))
        if len(ids) > 500 or any(not BBL.fullmatch(bbl) for bbl in ids):
            raise ValueError('Invalid parcel IDs')
        if not ids:
            return []
        placeholders = ','.join('?' for _ in ids)
        return [summary(row) for row in db.execute(
            f'SELECT {PROJECTION} {PARCELS} WHERE p.bbl IN ({placeholders})', ids)]
    return None
