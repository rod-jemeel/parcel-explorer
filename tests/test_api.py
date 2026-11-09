import json
import sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

@pytest.fixture
def client(tmp_path):
    from services.api.main import create_app
    release='bk-aaaaaaaaaaaa';base=tmp_path/release
    (base/'profiles').mkdir(parents=True)
    coverage={'release_id':release,'bounds':[-74,40,-73,41],'feature_count':2,'sources':[]}
    p={'id':'first-uuid','bbl':'3000010050','block':'1','lot':'50','address':'10 JAY STREET','land_use':'5','lot_area':19682,'year_built':1898,'assess_total':'32960250','bounds':[-73.99,40.70,-73.98,40.71],'center':[-73.985,40.705],'record_count':1,'release_id':release}
    other={**p,'id':'second-uuid','bbl':'3000020001','block':'2','lot':'1','address':'100 JAY STREET','lot_area':None,'record_count':0}
    (tmp_path/'coverage.json').write_text(json.dumps(coverage))
    (base/'index.json').write_text(json.dumps([p,other]))
    (base/'profiles'/(p['bbl']+'.json')).write_text(json.dumps(p))
    (base/'profiles'/(other['bbl']+'.json')).write_text(json.dumps(other))
    history=base/'history'/p['bbl']/'all';history.mkdir(parents=True)
    (history/'0.json').write_text(json.dumps({'release_id':release,'bbl':p['bbl'],'total':1,'next_page':None,'events':[{'id':'test-doc','type':'document','date':'2000-01-01','recording_date':'2020-01-01','source_record_id':'synthetic','amount':'0','property_bbls':[p['bbl']],'official_url':'https://example.invalid'}]}))
    return TestClient(create_app(tmp_path))

def test_release_is_required_and_stale_release_is_typed(client):
    assert client.get('/api/v1/search').status_code==422
    r=client.get('/api/v1/search?release_id=bk-bbbbbbbbbbbb')
    assert r.status_code==410
    assert r.json()['detail']['code']=='data_release_unavailable'
    assert r.json()['detail']['active_release_id']=='bk-aaaaaaaaaaaa'

def test_exact_identifier_profile_has_source_record(client):
    r=client.get('/api/v1/properties/3000010050?release_id=bk-aaaaaaaaaaaa')
    assert r.status_code==200 and r.json()['bbl']=='3000010050'
    h=client.get('/api/v1/properties/first-uuid/history?release_id=bk-aaaaaaaaaaaa').json()
    assert h['events'][0]['source_record_id']=='synthetic'
    assert h['events'][0]['recording_date']=='2020-01-01'

def test_zero_record_profile_needs_no_history_asset(client):
    r=client.get('/api/v1/properties/3000020001/history?release_id=bk-aaaaaaaaaaaa')
    assert r.status_code==200
    assert r.json()['events']==[] and r.json()['total']==0

def test_search_filter_nulls_and_cursors_are_scope_bound(client):
    r=client.get('/api/v1/search?release_id=bk-aaaaaaaaaaaa&q=jay&max_lot=20000').json()
    assert r['total']==1 and r['results'][0]['bbl']=='3000010050'
    page=client.get('/api/v1/search?release_id=bk-aaaaaaaaaaaa&q=jay&limit=1').json()
    assert page['next_cursor']
    next_page=client.get('/api/v1/search',params={'release_id':'bk-aaaaaaaaaaaa','q':'jay','limit':1,'cursor':page['next_cursor']}).json()
    assert next_page['results'][0]['bbl']!='3000010050'
    assert client.get('/api/v1/search',params={'release_id':'bk-aaaaaaaaaaaa','q':'other','limit':1,'cursor':page['next_cursor']}).status_code==400

def test_unknown_release_cannot_be_used_as_a_path(client):
    assert client.get('/api/v1/search',params={'release_id':'../../secrets'}).status_code in (410,422)
    assert client.get('/api/v1/properties/missing?release_id=bk-aaaaaaaaaaaa').status_code==404

def test_nonloopback_origin_is_not_given_cors_access(client):
    r=client.get('/api/v1/coverage',headers={'Origin':'https://untrusted.example'})
    assert 'access-control-allow-origin' not in r.headers

def test_api_rejects_oversized_input_and_inverted_bounds(client):
    assert client.get('/api/v1/search',params={'release_id':'bk-aaaaaaaaaaaa','limit':10000}).status_code==422
    assert client.get('/api/v1/search',params={'release_id':'bk-aaaaaaaaaaaa','bounds':'-73,41,-74,40'}).status_code==422

def test_unsupported_place_is_distinct_from_no_matches(client):
    r=client.get('/api/v1/search?release_id=bk-aaaaaaaaaaaa&q=Jersey%20City').json()
    assert r['coverage_status']=='outside_coverage'
    assert r['total']==0
