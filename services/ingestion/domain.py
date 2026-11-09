"""Source-specific identity and record semantics shared by imports and the API."""
from __future__ import annotations
import hashlib
import json
import os
import uuid
from decimal import Decimal, InvalidOperation
from pathlib import Path

PARSER_VERSION = 'brooklyn-pilot/5-buildings-assessment'
MAP_URL = 'https://www.arcgis.com/home/item.html?id=1564ace0b4f44318ac39920737f9bd07'
ACRIS_URL = 'https://a836-acris.nyc.gov/DS/DocumentSearch/DocumentDetail?doc_id='
SALES_URL = 'https://data.cityofnewyork.us/dataset/NYC-Citywide-Rolling-Calendar-Sales/usep-8jbt'

def normalize_bbl(borough, block, lot) -> str:
    values=[str(x).strip() for x in (borough,block,lot)]
    if any(not x.isdigit() for x in values):
        raise ValueError('BBL components must be digit strings')
    b,bl,l=map(int,values)
    if not (1<=b<=5 and 0<=bl<=99999 and 0<=l<=9999):
        raise ValueError('BBL component out of range')
    return f'{b}{bl:05d}{l:04d}'

def money(value) -> str | None:
    if value is None or str(value).strip() in ('','-','N/A'):
        return None
    try:
        n=Decimal(str(value).replace(',','').replace('$','').strip())
        return format(n,'f') if n.is_finite() else None
    except InvalidOperation:
        return None

def assessed_improvements(total,land):
    total,land=money(total),money(land)
    if total is None or land is None:return None
    result=Decimal(total)-Decimal(land)
    return format(result,'f') if result>=0 else None

def day(value) -> str | None:
    if not value: return None
    from datetime import date
    try: return date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError: return None

def entity_id(bbl: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL,'nyc:bbl:'+bbl))

def normalize_document(master: dict, legals: list[dict], *, recorded_from='2016-01-01') -> dict | None:
    recorded=day(master.get('recorded_datetime'))
    if not recorded or recorded<recorded_from: return None
    bbls=[]
    for legal in legals:
        try: b=normalize_bbl(legal['borough'],legal['block'],legal['lot'])
        except (ValueError,KeyError): continue
        if b not in bbls: bbls.append(b)
    doc=str(master['document_id'])
    return {
        'id':'acris:'+doc,'type':'document','source':'acris','source_record_id':doc,
        'document_type':master.get('doc_type','Unknown'),'date':day(master.get('document_date')),
        'recording_date':recorded,'amount':money(master.get('document_amt')),
        'amount_kind':'document_amount','currency':'USD','property_bbls':bbls,
        'allocation':'transaction_level_unallocated','official_url':ACRIS_URL+doc,
        'revision':master.get('modified_date') or master.get('good_through_date'),
        'association':'direct_bbl','date_basis':'recording_date',
    }

def normalize_sale(row: dict) -> dict:
    bbl=normalize_bbl(row['borough'],row['block'],row['lot'])
    amount=money(row.get('sale_price'))
    fingerprint=hashlib.sha256(json.dumps(row,sort_keys=True).encode()).hexdigest()
    return {'id':'dof:'+fingerprint[:24],'type':'transfer','source':'dof_sales',
            'source_record_id':fingerprint,'bbl':bbl,'date':day(row.get('sale_date')),
            'amount':amount,'amount_kind':'reported_sale_consideration','currency':'USD',
            'classification':'zero_consideration_transfer' if amount is not None and Decimal(amount)==0 else 'reported_transfer',
            'property_bbls':[bbl],'allocation':'source_row_amount_allocation_unverified',
            'official_url':SALES_URL,'apartment':row.get('apartment'),'association':'direct_bbl',
            'date_basis':'sale_date'}

def normalize_permit(row:dict, source:str) -> dict:
    from datetime import datetime
    def source_date(value):
        if not value:return None
        try:return datetime.strptime(str(value)[:10],'%m/%d/%Y').date().isoformat()
        except ValueError:return day(value)
    if source=='dob_bis':
        bbl=normalize_bbl('3',row['block'],row['lot'])
        identity=row.get('permit_si_no')
        if not identity:raise ValueError('BIS permit lacks source permit ID')
        job=row.get('job__');date=source_date(row.get('issuance_date'))
        url='https://a810-bisweb.nyc.gov/bisweb/JobsQueryByNumberServlet?passjobnumber='+str(job)
        bin_value=row.get('bin__')
    elif source=='dob_now':
        bbl=str(row.get('bbl',''))
        if not (len(bbl)==10 and bbl.isdigit() and bbl.startswith('3')):raise ValueError('DOB NOW row lacks a Brooklyn BBL')
        identity=row.get('source_row_id') or row.get('tracking_number')
        if not identity:raise ValueError('DOB NOW row lacks source row identity')
        job=row.get('job_filing_number');date=source_date(row.get('issued_date'))
        url='https://data.cityofnewyork.us/Housing-Development/DOB-NOW-Build-Approved-Permits/rbx6-tga4'
        bin_value=row.get('bin')
    else:raise ValueError('Unknown permit source')
    return {'id':source+':'+str(identity),'type':'permit','source':source,'source_record_id':str(identity),'date':date,
            'amount':None,'amount_kind':'not_applicable','currency':'USD','property_bbls':[bbl],'allocation':'not_applicable',
            'official_url':url,'permit_job':job,'status':row.get('permit_status'),'work_type':row.get('work_type') or row.get('job_type'),
            'bin':bin_value,'expiration_date':source_date(row.get('expiration_date')),'association':'direct_bbl',
            'date_basis':'permit_issuance_date','observation_note':'Current source status observation, not a reconstructed permit lifecycle.'}

def normalize_feature(feature: dict) -> dict:
    p=feature['properties']; bbl=normalize_bbl(p['BoroCode'] if p.get('BoroCode') else '3',str(p['Block']),str(p['Lot']))
    if p.get('BBL') is not None and str(int(p['BBL']))!=bbl: raise ValueError('BBL differs from components')
    condo=bool(p.get('CondoNo'))
    geom=feature['geometry']
    def points(v):
        if len(v)>=2 and isinstance(v[0],(float,int)): yield v
        else:
            for x in v: yield from points(x)
    coords=list(points(geom['coordinates']))
    bounds=[min(x[0] for x in coords),min(x[1] for x in coords),max(x[0] for x in coords),max(x[1] for x in coords)]
    return {'id':entity_id(bbl),'bbl':bbl,'block':str(p['Block']),'lot':str(p['Lot']),
            'address':p.get('Address') or f'Block {p["Block"]}, lot {p["Lot"]}',
            'jurisdiction':'brooklyn','entity_kind':'billing_group' if condo else 'parcel',
            'relationships_status':'unit_crosswalk_not_imported' if condo else 'not_imported',
            'condo_number':p.get('CondoNo'),'land_use':str(int(p['LandUse'])) if p.get('LandUse') else None,
            'building_class':p.get('BldgClass'),'lot_area':p.get('LotArea'), 'building_area':p.get('BldgArea'),
            'year_built':p.get('YearBuilt') or None,'units':p.get('UnitsTotal'),'residential_units':p.get('UnitsRes'),
            'floors':p.get('NumFloors'),'buildings':p.get('NumBldgs'),'zoning':p.get('ZoneDist1'),
            'assess_total':money(p.get('AssessTot')),'assess_land':money(p.get('AssessLand')),
            'assess_improvements':assessed_improvements(p.get('AssessTot'),p.get('AssessLand')),'assessment_year':None,
            'assessment_calculation':'MapPLUTO AssessTot minus AssessLand; decimal subtraction v1. Total already includes improvements. No per-building allocation is supplied.',
            'source':'mappluto','source_record_id':str(p.get('OBJECTID',feature.get('id'))),
            'source_edition':p.get('Version'),'source_url':MAP_URL,'postal_code':p.get('ZipCode'),
            'historic_district':p.get('HistDist'),'bounds':bounds,
            'center':[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2]}

def publish_release(public_root: Path, manifest: dict, *, expected_count: int, actual_count: int):
    if expected_count<=0 or actual_count!=expected_count:
        raise ValueError(f'Truncated import: expected {expected_count}, received {actual_count}')
    public_root.mkdir(parents=True,exist_ok=True)
    temp=public_root/'coverage.json.tmp'
    temp.write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    os.replace(temp,public_root/'coverage.json')
