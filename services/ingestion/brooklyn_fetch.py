"""Download restartable, counted borough snapshots before joining them locally."""
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import date, timedelta
import gzip
import hashlib
import io
import json
from pathlib import Path
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from services.ingestion.import_pilot import ARCGIS, ROOT

STAGE = ROOT / 'data' / 'brooklyn-stage'
NYC = 'https://data.cityofnewyork.us'
DATASETS = {
    'buildings': ('5zhs-2jue', "base_bbl like '3%' or mappluto_bbl like '3%' or bin between 3000000 and 3999999", 'doitt_id,bin,base_bbl,mappluto_bbl,name,construction_year,last_edited_date,last_status_type,the_geom'),
    'dob_bis': ('ipu4-2q9a', "borough='BROOKLYN'", 'borough,block,lot,bin__,job__,job_type,work_type,permit_status,permit_type,permit_si_no,issuance_date,expiration_date,dobrundate'),
    'dob_now': ('rbx6-tga4', "borough='BROOKLYN'", 'bbl,borough,block,lot,bin,job_filing_number,tracking_number,work_type,permit_status,issued_date,expired_date'),
    'sales': ('usep-8jbt', "borough='3'", '*'),
    'legals': ('8h5j-fqxa', "document_id >= '2016' and document_id < 'A'", 'document_id,borough,block,lot'),
    'master': ('bnx9-e6tj', "recorded_datetime >= '2016-01-01T00:00:00'", 'document_id,doc_type,document_date,recorded_datetime,document_amt,modified_date,good_through_date'),
}


def request(url, params=None):
    if params:
        url += '?' + urlencode(params)
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers={'Accept-Encoding': 'gzip', 'User-Agent': 'ParcelExplorer-local research'}), timeout=90) as response:
                payload = response.read()
                return gzip.decompress(payload) if response.headers.get('Content-Encoding') == 'gzip' else payload
        except (OSError, TimeoutError) as error:
            if attempt == 3:
                raise
            print(f'Retrying {url[:85]} after {error}', flush=True)
            time.sleep(2 ** (attempt + 1))


def atomic(path, data):
    temp = path.with_suffix('.partial')
    temp.write_bytes(data)
    temp.replace(path)


def json_request(url, params=None):
    data = json.loads(request(url, params))
    if isinstance(data, dict) and data.get('error'):
        raise ValueError(data['error'])
    return data


def parcels():
    query = {'where': "Borough='BK'"}
    revision = json_request(ARCGIS, {'f': 'json'})['editingInfo']['dataLastEditDate']
    count = json_request(ARCGIS + '/query', {**query, 'f': 'json', 'returnCountOnly': 'true'})['count']
    folder = STAGE / 'parcels' / str(revision)
    folder.mkdir(parents=True, exist_ok=True)
    size = 1000
    for offset in range(0, count, size):
        path = folder / f'{offset:09d}.json.gz'
        if not path.exists():
            result = json_request(ARCGIS + '/query', {
                **query, 'f': 'geojson', 'outSR': 4326, 'orderByFields': 'OBJECTID',
                'outFields': 'OBJECTID,BBL,BoroCode,Block,Lot,Address,CondoNo,LandUse,BldgClass,LotArea,BldgArea,YearBuilt,UnitsTotal,UnitsRes,NumFloors,NumBldgs,ZoneDist1,AssessTot,AssessLand,Version,ZipCode,HistDist',
                'resultRecordCount': size, 'resultOffset': offset,
            })
            if len(result.get('features', [])) != min(size, count - offset):
                raise ValueError(f'MapPLUTO page truncated at {offset}')
            atomic(path, gzip.compress(json.dumps(result['features'], separators=(',', ':')).encode(), compresslevel=1))
        if offset % 10000 == 0:
            print(f'parcels: {min(offset+size,count):,}/{count:,}', flush=True)
    if revision != json_request(ARCGIS, {'f': 'json'})['editingInfo']['dataLastEditDate']:
        raise ValueError('MapPLUTO source changed during download')
    return {'name': 'parcels', 'revision': revision, 'count': count, 'folder': str(folder), 'size': size}


def socrata_snapshot(name):
    dataset, where, fields = DATASETS[name]
    url = f'{NYC}/resource/{dataset}'
    meta_url = f'{NYC}/api/views/{dataset}.json'
    metadata = json_request(meta_url)
    revision = metadata['rowsUpdatedAt']
    if fields == '*':
        fields = ','.join(column['fieldName'] for column in metadata['columns']
                          if not column['fieldName'].startswith(':'))
    if name in ('master', 'legals'):
        return dated_snapshot(name, dataset, url, meta_url, revision, fields)
    count = int(json_request(url + '.json', {'$select': 'count(*)', '$where': where})[0]['count'])
    folder = STAGE / name / str(revision)
    folder.mkdir(parents=True, exist_ok=True)
    size = 10000 if name == 'buildings' else 50000
    # An explicit ordering gives reproducible, non-overlapping snapshots.
    for offset in range(0, count, size):
        path = folder / f'{offset:09d}.csv.gz'
        if not path.exists():
            payload = request(url + '.csv', {'$select': ':id as source_row_id,' + fields,
                '$where': where, '$order': ':id', '$limit': size, '$offset': offset})
            reader = csv.DictReader(io.StringIO(payload.decode('utf-8-sig')))
            if 'source_row_id' not in (reader.fieldnames or []) or sum(1 for _ in reader) != min(size, count-offset):
                raise ValueError(f'{name}: page truncated or schema mismatch at {offset}')
            atomic(path, gzip.compress(payload, compresslevel=1))
        if offset % (size * 5) == 0 or offset + size >= count:
            print(f'{name}: {min(offset+size,count):,}/{count:,}', flush=True)
    if json_request(meta_url)['rowsUpdatedAt'] != revision:
        raise ValueError(f'{name} changed during download')
    return {'name': name, 'dataset': dataset, 'revision': revision, 'count': count, 'folder': str(folder), 'size': size}


def dated_snapshot(name, dataset, url, meta_url, revision, fields):
    """Use disjoint date windows to avoid deep offsets on citywide ACRIS tables."""
    folder = STAGE / name / f'{revision}-dates'
    folder.mkdir(parents=True, exist_ok=True)
    limit = 100000

    def window(dates):
        start, end = dates
        if name == 'master':
            where = f"recorded_datetime >= '{start}T00:00:00' and recorded_datetime < '{end}T00:00:00'"
        else:
            where = f"document_id >= '{start:%Y%m%d}' and document_id < '{end:%Y%m%d}'"
        path = folder / f'{start}_{end}.csv.gz'
        if path.exists():
            payload = gzip.decompress(path.read_bytes())
        else:
            payload = request(url + '.csv', {'$select': ':id as source_row_id,' + fields,
                                             '$where': where, '$limit': limit})
        reader = csv.DictReader(io.StringIO(payload.decode('utf-8-sig')))
        if 'source_row_id' not in (reader.fieldnames or []):
            raise ValueError(f'{name}: schema mismatch for {start} to {end}')
        count = sum(1 for _ in reader)
        if count >= limit:
            days = (end - start).days
            if days < 2:
                raise ValueError(f'{name}: one day exceeded the query limit')
            middle = start + timedelta(days=days // 2)
            return window((start, middle)) + window((middle, end))
        if not path.exists():
            atomic(path, gzip.compress(payload, compresslevel=1))
        return [(path.name, count)]

    months = []
    start = date(2016, 1, 1)
    while start <= date.today():
        end = date(start.year + (start.month == 12), start.month % 12 + 1, 1)
        months.append((start, end))
        start = end
    pages = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for i, group in enumerate(pool.map(window, months), 1):
            pages.extend(group)
            if i % 12 == 0 or i == len(months):
                print(f'{name}: checked {i}/{len(months)} monthly windows', flush=True)
    if json_request(meta_url)['rowsUpdatedAt'] != revision:
        raise ValueError(f'{name} changed during download')
    return {'name': name, 'dataset': dataset, 'revision': revision, 'folder': str(folder),
            'count': sum(count for _, count in pages), 'files': [filename for filename, _ in pages]}


def rows(snapshot):
    folder = Path(snapshot['folder'])
    if 'files' in snapshot:
        for filename in snapshot['files']:
            with gzip.open(folder / filename, 'rt', encoding='utf-8-sig', newline='') as stream:
                yield from csv.DictReader(stream)
        return
    for offset in range(0, snapshot['count'], snapshot['size']):
        stem = folder / f'{offset:09d}'
        if snapshot['name'] == 'parcels':
            yield from json.loads(gzip.decompress(stem.with_suffix('.json.gz').read_bytes()))
        else:
            with gzip.open(stem.with_suffix('.csv.gz'), 'rt', encoding='utf-8-sig', newline='') as stream:
                yield from csv.DictReader(stream)


def run(names):
    STAGE.mkdir(parents=True, exist_ok=True)

    def job(name):
        result = parcels() if name == 'parcels' else socrata_snapshot(name)
        atomic(STAGE / f'{name}.json', json.dumps(result).encode())
        print(f'Validated {name} snapshot: {result["count"]:,} rows', flush=True)
        return result

    with ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(job, names):
            pass


if __name__ == '__main__':
    import sys
    run(sys.argv[1:] or ['parcels', 'buildings', 'master', 'legals', 'dob_bis', 'dob_now', 'sales'])
