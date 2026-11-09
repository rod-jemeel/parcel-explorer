"""Additional official sources; no model is needed to retrieve exact BBL matches."""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from services.ingestion.domain import normalize_document,normalize_bbl,normalize_permit

BACKFILL_BBLS=['3002480001','3000010050','3000537501']

def chunks(values,n):
    for i in range(0,len(values),n):yield values[i:i+n]

def backfill_documents(profiles,socrata):
    legal_rows=[];reports=[]
    for bbl in BACKFILL_BBLS:
        if bbl not in profiles:continue
        p=profiles[bbl]
        where=f"borough='3' and block='{p['block']}' and lot='{p['lot']}'"
        expected=int(socrata('8h5j-fqxa',{'$select':'count(*)','$where':where})[0]['count'])
        rows=[]
        for offset in range(0,expected,2000):
            rows.extend(socrata('8h5j-fqxa',{'$where':where,'$order':'document_id,record_type','$limit':2000,'$offset':offset}))
        if len(rows)!=expected:raise ValueError('Targeted ACRIS legal count mismatch')
        legal_rows.extend(rows);reports.append({'bbl':bbl,'address':p['address'],'legal_associations':len(rows),'status':'source_metadata_backfill','note':'All returned exact-BBL legal associations were enumerated. Master metadata is included where recording date is supplied from 1966. This does not prove that every historical document was digitized.'})
    ids=sorted({r['document_id'] for r in legal_rows});masters=[];all_legs=[]
    def fetch_pair(ids):
        condition='document_id in('+','.join("'"+i+"'" for i in ids)+')'
        m=socrata('bnx9-e6tj',{'$where':condition,'$limit':50000,'$order':'document_id'})
        l=socrata('8h5j-fqxa',{'$where':condition,'$limit':50000,'$order':'document_id,borough,block,lot'})
        if len(m)>=50000 or len(l)>=50000:raise ValueError('Backfill join exceeds bounded response size')
        return m,l
    with ThreadPoolExecutor(max_workers=2) as pool:
        for m,l in pool.map(fetch_pair,list(chunks(ids,60))):masters.extend(m);all_legs.extend(l)
    by_doc={}
    for l in all_legs:by_doc.setdefault(l['document_id'],[]).append(l)
    records={}
    for m in masters:
        record=normalize_document(m,by_doc.get(m['document_id'],[]),recorded_from='1966-01-01')
        if record:
            record['raw_record_hash']=hashlib.sha256(json.dumps(m,sort_keys=True).encode()).hexdigest()
            record['import_scope']='targeted_historical_backfill'
            records[record['id']]=record
    for report in reports:
        linked=[r for r in records.values() if report['bbl'] in r['property_bbls']]
        report['document_count']=len(linked)
        report['through']=max((r['recording_date'] for r in linked),default=None)
        report['imported_from']=min((r['recording_date'] for r in linked),default=None)
        print(f"  historical backfill {report['address']}: {len(linked)} ACRIS documents",flush=True)
    return list(records.values()),reports

def import_permits(profiles,socrata):
    blocks=sorted({p['block'] for p in profiles.values()},key=int)
    records={};coverage=[]
    for dataset,source in [('ipu4-2q9a','dob_bis'),('rbx6-tga4','dob_now')]:
        is_bis=source=='dob_bis';source_rows=[]
        def fetch_blocks(group):
            values=','.join("'"+(b.zfill(5) if is_bis else b)+"'" for b in group)
            where="borough='BROOKLYN' and block in("+values+")"
            expected=int(socrata(dataset,{'$select':'count(*)','$where':where})[0]['count'])
            rows=[]
            fields=(':id as source_row_id,borough,block,lot,bin__,job__,job_type,work_type,permit_status,permit_type,permit_si_no,issuance_date,expiration_date,dobrundate' if is_bis else ':id as source_row_id,bbl,borough,block,lot,bin,job_filing_number,tracking_number,work_type,permit_status,issued_date,expired_date')
            for offset in range(0,expected,5000):
                page=socrata(dataset,{'$select':fields,'$where':where,'$order':':id','$limit':5000,'$offset':offset});rows.extend(page)
            after=int(socrata(dataset,{'$select':'count(*)','$where':where})[0]['count'])
            if len(rows)!=expected or after!=expected:raise ValueError('Permit extraction count drift; prior release is retained')
            return rows
        with ThreadPoolExecutor(max_workers=3) as pool:
            for rows in pool.map(fetch_blocks,[blocks[i::3] for i in range(3)]):source_rows.extend(rows)
        skipped=0;linked=0;dates=[]
        for row in source_rows:
            try:record=normalize_permit(row,source)
            except (ValueError,KeyError):skipped+=1;continue
            if record['property_bbls'][0] not in profiles:continue
            record['raw_record_hash']=hashlib.sha256(json.dumps(row,sort_keys=True).encode()).hexdigest()
            records[record['id']]=record;linked+=1
            if record['date']:dates.append(record['date'])
        coverage.append({'id':source,'name':'DOB BIS building permits' if is_bis else 'DOB NOW approved permits','agency':'NYC Department of Buildings','dataset':dataset,
            'url':'https://data.cityofnewyork.us/d/'+dataset,'status':'bounded','date_basis':'permit_issuance_date','imported_from':min(dates) if dates else None,'through':max(dates) if dates else None,
            'source_rows':len(source_rows),'linked_records':linked,'quarantined_rows':skipped,
            'note':'Published source rows for pilot blocks, then exact-BBL matched to imported parcels. Current permit statuses are observations; prior lifecycle states are not reconstructed. Undated permits remain undated. Excludes DOB categories outside this dataset and does not infer condo-unit associations.'})
        print(f'  {source}: {linked} linked permits; {skipped} rows without usable identity',flush=True)
    return list(records.values()),coverage
