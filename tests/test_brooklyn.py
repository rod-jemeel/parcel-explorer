import json
import sqlite3
from contextlib import closing

from services.api.brooklyn import route
from services.ingestion.brooklyn_release import init, insert_event


def test_borough_reads_preserve_shared_records_and_bound_history():
    release = 'bk-123456789abc'
    ids = ('3000010001', '3000010002', '3000010003')
    with closing(sqlite3.connect(':memory:')) as db:
        init(db)
        for bbl, address, west in zip(ids, ('1 TEST ST', '2 TEST ST', '3 TEST ST'), (-74, -73.9, -73.8)):
            profile = {'bbl': bbl, 'address': address, 'buildings': 1, 'release_id': release}
            db.execute('INSERT INTO parcel VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                       (bbl, address, '1', 100, 1940, 12000, west, 40.6, west + .01, 40.61, json.dumps(profile)))
        for number in range(41):
            record = {'id': f'acris:{number:02}', 'type': 'document', 'source': 'acris',
                      'date': '2020-01-01', 'property_bbls': [*ids[:2], '1000010001'],
                      'amount': '120000'}
            assert insert_event(db, record, set(ids), release)
        db.executescript("""
            CREATE TABLE stats AS SELECT bbl,count(*) AS total, count(*) AS document,
                 0 AS transfer, 0 AS permit, NULL AS latest_transfer FROM link GROUP BY bbl;
        """)
        found = route(db, release, 'search.json', 'q=test&limit=1&bounds=-74.01,40.5,-73.89,40.7')
        assert found['total'] == 2
        assert [p['bbl'] for p in found['results']] == [ids[0]]
        assert route(db, release, 'search.json', f'q={ids[1]}')['total'] == 1
        first = route(db, release, f'history/{ids[0]}/document/0.json', '')
        last = route(db, release, f'history/{ids[0]}/document/1.json', '')
        assert first['total'] == 41 and len(first['events']) == 40 and first['next_page'] == 1
        assert len(last['events']) == 1 and last['next_page'] is None
        assert last['events'][0]['amount'] == '120000'
        assert last['events'][0]['property_bbls'] == [*ids[:2], '1000010001']
        assert last['events'][0]['release_id'] == release
