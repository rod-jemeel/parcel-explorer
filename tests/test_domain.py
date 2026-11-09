"""Synthetic fixtures only; no fixture is published as a government record."""
import sys
from pathlib import Path
from datetime import date
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

def test_identifier_format_keeps_leading_zeroes():
    from services.ingestion.domain import normalize_bbl
    assert normalize_bbl('3', '00001', '00050') == '3000010050'
    with pytest.raises(ValueError):
        normalize_bbl('3', '1.5', '50')
    with pytest.raises(ValueError):
        normalize_bbl('3', '1', '10000')

def test_old_document_recorded_in_window_is_included():
    from services.ingestion.domain import normalize_document
    record = normalize_document({'document_id':'X','doc_type':'DEED','document_date':'1999-01-01T00:00:00', 'recorded_datetime':'2017-02-03T00:00:00','document_amt':'0'}, [{'borough':'3','block':'1','lot':'50'}])
    assert record['date'] == '1999-01-01'
    assert record['recording_date'] == '2017-02-03'
    assert record['amount'] == '0'
    assert record['amount_kind'] == 'document_amount'
    assert normalize_document({'document_id':'Y', 'recorded_datetime':'2015-12-31T00:00:00'}, []) is None

def test_multi_property_amount_is_not_allocated():
    from services.ingestion.domain import normalize_document
    record = normalize_document({'document_id':'X','doc_type':'MTGE','recorded_datetime':'2024-01-01T00:00:00','document_amt':'1234567.89'}, [{'borough':'3','block':'1','lot':'50'}, {'borough':'3','block':'2','lot':'1'}, {'borough':'3','block':'1','lot':'50'}])
    assert record['property_bbls'] == ['3000010050','3000020001']
    assert record['amount'] == '1234567.89'
    assert record['amount_kind'] == 'document_amount'
    assert record['allocation'] == 'transaction_level_unallocated'

def test_transfer_zero_is_visible_and_unknown_is_null():
    from services.ingestion.domain import normalize_sale
    record=normalize_sale({'borough':'3','block':'1','lot':'50','sale_date':'2025-01-01T00:00:00','sale_price':'0'})
    assert record['amount'] == '0'
    assert record['classification'] == 'zero_consideration_transfer'
    assert normalize_sale({'borough':'3','block':'1','lot':'50','sale_price':''})['amount'] is None

def test_source_year_zero_is_unknown_and_money_is_decimal_text():
    from services.ingestion.domain import normalize_feature
    p=normalize_feature({'properties':{'BBL':3000010050.0,'Borough':'BK','Block':1,'Lot':50,'Address':'10 JAY STREET','YearBuilt':0,'AssessTot':32960250.12,'CondoNo':765,'Version':'26v2'}, 'geometry':{'type':'Polygon','coordinates':[[[-74,40],[-73,40],[-73,41],[-74,40]]]}})
    assert p['year_built'] is None
    assert p['assess_total'] == '32960250.12'
    assert p['entity_kind'] == 'billing_group'
    assert p['relationships_status'] == 'unit_crosswalk_not_imported'
    assert p['bbl'] == '3000010050'

def test_failed_release_never_replaces_active_manifest(tmp_path):
    from services.ingestion.domain import publish_release
    (tmp_path/'coverage.json').write_text('{"release_id":"old"}')
    with pytest.raises(ValueError):
        publish_release(tmp_path, {'release_id':'new'}, expected_count=2, actual_count=1)
    assert (tmp_path/'coverage.json').read_text() == '{"release_id":"old"}'

def test_publish_switches_only_after_validated_counts(tmp_path):
    from services.ingestion.domain import publish_release
    publish_release(tmp_path, {'release_id':'new'}, expected_count=2, actual_count=2)
    import json
    assert json.loads((tmp_path/'coverage.json').read_text())['release_id']=='new'

def test_new_source_edition_does_not_reuse_old_geometry_cache(tmp_path,monkeypatch):
    import json
    from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
    from threading import Thread
    from services.ingestion import import_pilot
    counter={'requests':0}
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            counter['requests']+=1
            body=json.dumps({'edition_value':counter['requests']}).encode()
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    monkeypatch.setattr(import_pilot,'RAW',tmp_path)
    try:
        url=f'http://127.0.0.1:{server.server_port}/geometry'
        assert import_pilot.fetch(url,namespace='edition-a')['edition_value']==1
        assert import_pilot.fetch(url,namespace='edition-a')['edition_value']==1
        assert import_pilot.fetch(url,namespace='edition-b')['edition_value']==2
    finally:server.shutdown();server.server_close()

def test_explicit_historical_backfill_preserves_pre2016_recording():
    from services.ingestion.domain import normalize_document
    row={'document_id':'FT_SYNTHETIC','doc_type':'DEED','document_date':'1970-03-01','recorded_datetime':'1970-03-10','document_amt':'30000'}
    assert normalize_document(row,[]) is None
    result=normalize_document(row,[],recorded_from='1966-01-01')
    assert result['recording_date']=='1970-03-10'
    assert result['date']=='1970-03-01'

def test_bis_permit_uses_official_identifier_and_supplied_issuance_date():
    from services.ingestion.domain import normalize_permit
    p=normalize_permit({'borough':'BROOKLYN','block':'00248','lot':'00001','permit_si_no':'1830488','job__':'301279015','issuance_date':'09/13/2005','permit_status':'ISSUED','work_type':'OT'},'dob_bis')
    assert p['property_bbls']==['3002480001']
    assert p['id']=='dob_bis:1830488'
    assert p['date']=='2005-09-13'
    assert p['amount'] is None
    assert p['status']=='ISSUED'
    assert p['amount_kind']=='not_applicable'

def test_now_permit_without_date_stays_undated_and_is_not_a_zero_cost():
    from services.ingestion.domain import normalize_permit
    p=normalize_permit({'bbl':'3002480001','source_row_id':'synthetic-row','tracking_number':'111','job_filing_number':'B000000001-I1','permit_status':'Approved','estimated_job_costs':'100'},'dob_now')
    assert p['date'] is None
    assert p['amount'] is None
    assert p['date_basis']=='permit_issuance_date'

def test_improvements_assessment_is_exact_total_minus_land_not_extra_value():
    from services.ingestion.domain import assessed_improvements
    assert assessed_improvements('150000.12','40000.10')=='110000.02'
    assert assessed_improvements('0','0')=='0'
    assert assessed_improvements(None,'40000') is None
    assert assessed_improvements('10000','20000') is None

def test_building_uses_official_mappluto_crosswalk_and_never_spatial_guess():
    from services.ingestion.nyc_buildings import normalize_building
    row={'doitt_id':'478226','bin':'3002040','base_bbl':'3002480001','mappluto_bbl':'3002480001','construction_year':'1840','the_geom':{'type':'MultiPolygon','coordinates':[]}}
    result=normalize_building(row,{'3002480001':{}})
    assert result['bbl']=='3002480001' and result['bin']=='3002040'
    assert result['association']=='official_mappluto_bbl'
    assert normalize_building({**row,'base_bbl':'3009990001','mappluto_bbl':'3009990001'},{'3002480001':{}}) is None
