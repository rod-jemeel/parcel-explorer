"""Reproducible, checkpointed government-data import. Run from the repository root.

Acquisition writes raw request/response evidence by content hash. No API call is
triggered by a map click. `--publish` activates a release only after tile build.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import time
from datetime import datetime, timezone
from functools import partial
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from services.ingestion.domain import *
from services.ingestion.nyc_records import backfill_documents,import_permits
from services.ingestion.nyc_buildings import import_buildings,IMAGERY_URL

ROOT=Path(__file__).resolve().parents[2]
RAW=ROOT/'data'/'raw'
PUBLIC=ROOT/'apps'/'web'/'public'/'data'
ARCGIS='https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/ArcGIS/rest/services/MAPPLUTO/FeatureServer/0'
BOUNDS=[-74.009,40.684,-73.975,40.711]
LEGAL_LIMIT=3000
REFRESH=False

def fetch(url: str, params: dict | None=None, *, refresh=False, namespace:str='') -> dict | list:
    url=url+('?' + urlencode(params) if params else '')
    key=hashlib.sha256((url+('|snapshot:'+namespace if namespace else '')).encode()).hexdigest()
    RAW.mkdir(parents=True,exist_ok=True)
    meta_path=RAW/(key+'.meta.json')
    if meta_path.exists() and not (refresh or REFRESH):
        meta=json.loads(meta_path.read_text())
        blob=RAW/(meta['sha256']+'.json')
        content=blob.read_bytes()
        if hashlib.sha256(content).hexdigest()!=meta['sha256']: raise ValueError('Raw archive hash mismatch')
        return json.loads(content)
    error=None
    for attempt in range(3):
        try:
            request=Request(url,headers={'User-Agent':'ParcelExplorer-local-pilot/0.1 (government open-data research)','Accept':'application/json'})
            with urlopen(request,timeout=35) as response:
                payload=response.read()
                data=json.loads(payload)
                if isinstance(data,dict) and ('error' in data or data.get('code') in ('query.compiler.malformed','query.soql.no-such-column')):
                    raise ValueError(str(data)[:500])
                digest=hashlib.sha256(payload).hexdigest()
                (RAW/(digest+'.json')).write_bytes(payload)
                meta={'url':url,'sha256':digest,'fetched_at':datetime.now(timezone.utc).isoformat(),'bytes':len(payload),'etag':response.headers.get('etag'),'last_modified':response.headers.get('last-modified')}
                tmp=meta_path.with_suffix('.tmp')
                tmp.write_text(json.dumps(meta),encoding='utf-8');os.replace(tmp,meta_path)
                return data
        except Exception as e:
            error=e
            if attempt<2:time.sleep(1+attempt*2)
    raise RuntimeError(f'Fetch failed: {url[:180]}: {error}')

def socrata(dataset: str, query: dict) -> list:
    return fetch(f'https://data.cityofnewyork.us/resource/{dataset}.json',query)

def batches(items, size):
    for offset in range(0,len(items),size):yield items[offset:offset+size]

def arc_features(ids,edition:str):
    data=fetch(ARCGIS+'/query',{'f':'geojson','objectIds':','.join(map(str,ids)),'outFields':'*','outSR':4326,'returnGeometry':'true'},namespace=edition)
    if len(data.get('features',[]))!=len(ids):raise ValueError('Incomplete geometry batch')
    return data['features']

def write_json(path, data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')

def import_parcels():
    metadata=fetch(ARCGIS,{'f':'json'},refresh=True)
    query={'f':'json','where':"Borough='BK'",'geometry':','.join(map(str,BOUNDS)),'geometryType':'esriGeometryEnvelope','inSR':4326,'spatialRel':'esriSpatialRelIntersects'}
    count=fetch(ARCGIS+'/query',{**query,'returnCountOnly':'true'},refresh=True)['count']
    ids=fetch(ARCGIS+'/query',{**query,'returnIdsOnly':'true'},refresh=True)['objectIds']
    if len(set(ids))!=count:raise ValueError('Feature ID enumeration does not match count')
    print(f'Acquiring {count} real MapPLUTO footprints',flush=True)
    features=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for page in pool.map(partial(arc_features,edition=str(metadata['editingInfo']['dataLastEditDate'])),list(batches(sorted(ids),100))):
            features.extend(page);print(f'  geometry {len(features)}/{count}',flush=True)
    after=fetch(ARCGIS,{'f':'json'},refresh=True)
    if metadata.get('editingInfo')!=after.get('editingInfo'):raise ValueError('Source changed during geometry extraction; retry')
    if len(features)!=count:raise ValueError('Feature count drift')
    profiles={}; seen=set()
    for feature in features:
        p=normalize_feature(feature)
        if p['bbl'] in seen:raise ValueError('Ambiguous duplicate BBL needs review before publication')
        seen.add(p['bbl']);profiles[p['bbl']]=p
    return features,profiles,metadata,count

def import_sales(profiles):
    rows=[];offset=0
    while True:
        page=socrata('usep-8jbt',{'$where':"borough='3'",'$order':'sale_date,block,lot,address,sale_price','$limit':5000,'$offset':offset})
        rows.extend(page)
        print(f'  DOF source rows {len(rows)}',flush=True)
        if len(page)<5000:break
        offset+=len(page)
        if offset>100000:raise ValueError('Unexpected rolling sales volume')
    records={}; source_dates=[]
    for row in rows:
        r=normalize_sale(row)
        if r['date']:source_dates.append(r['date'])
        if r['bbl'] in profiles:
            r['raw_record_hash']=hashlib.sha256(json.dumps(row,sort_keys=True).encode()).hexdigest()
            records[r['id']]=r
    return list(records.values()), {'id':'dof_sales','name':'DOF rolling sales','agency':'NYC Department of Finance','dataset':'usep-8jbt','url':SALES_URL,'status':'bounded',
        'date_basis':'sale_date','imported_from':min(source_dates) if source_dates else None,'through':max(source_dates) if source_dates else None,
        'source_rows':len(rows),'linked_records':len(records),'note':'Published rolling file only. Annual sales backfill since 2016 is not imported. Identical full-row observations are grouped by payload hash; other apparent duplicates remain visible.'}

def import_documents(profiles):
    # This is deliberately a bounded association sample, never complete 2016 history.
    blocks=sorted({p['block'] for p in profiles.values()},key=int)
    legal_pages=[]
    def legal_chunk(chunk):
        values=','.join("'"+b+"'" for b in chunk)
        return socrata('8h5j-fqxa',{'$where':"borough='3' and document_id < 'A' and block in("+values+")",'$order':'document_id DESC,block,lot','$limit':LEGAL_LIMIT//3})
    chunks=[blocks[i::3] for i in range(3)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for page in pool.map(legal_chunk,chunks):legal_pages.extend(page)
    legal_ids=set()
    for l in legal_pages:
        try:b=normalize_bbl(l['borough'],l['block'],l['lot'])
        except (ValueError,KeyError):continue
        if b in profiles:legal_ids.add(l['document_id'])
    ids=sorted(legal_ids)
    print(f'ACRIS bounded legal sample: {len(legal_pages)} rows; {len(ids)} matching document IDs',flush=True)
    masters=[];all_legals=[]
    def doc_chunk(chunk):
        values=','.join("'"+x+"'" for x in chunk)
        condition='document_id in('+values+')'
        m=socrata('bnx9-e6tj',{'$where':condition+" and recorded_datetime >= '2016-01-01T00:00:00'",'$limit':50000,'$order':'document_id'})
        l=socrata('8h5j-fqxa',{'$where':condition,'$limit':50000,'$order':'document_id,borough,block,lot'})
        if len(m)==50000 or len(l)==50000:raise ValueError('Document join exceeded explicit page cap')
        return m,l
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for m,l in pool.map(doc_chunk,list(batches(ids,70))):
            masters.extend(m);all_legals.extend(l)
            print(f'  joined ACRIS masters {len(masters)}',flush=True)
    by_doc={}
    for l in all_legals:by_doc.setdefault(l['document_id'],[]).append(l)
    records={}
    for master in masters:
        r=normalize_document(master,by_doc.get(master['document_id'],[]))
        if r:
            r['raw_record_hash']=hashlib.sha256(json.dumps(master,sort_keys=True).encode()).hexdigest()
            records[r['id']]=r
    dates=[r['recording_date'] for r in records.values()]
    return list(records.values()),{'id':'acris','name':'ACRIS recorded documents','agency':'NYC Department of Finance','dataset':'bnx9-e6tj + 8h5j-fqxa',
        'url':'https://www.nyc.gov/site/finance/property/acris.page','status':'partial','date_basis':'recording_date','requested_from':'2016-01-01',
        'imported_from':min(dates) if dates else None,'through':max(dates) if dates else None,'linked_records':len(records),
        'association_sample_rows':len(legal_pages),'note':f'Bounded sample of up to {LEGAL_LIMIT:,} legal associations with numeric-style document IDs, sorted descending across three block groups; Master is joined by document ID and filtered by recording date from 2016. Legacy letter-prefixed IDs are excluded from this candidate sample. This is NOT complete 2016-onward history. All legal property associations for each selected document are retained; Parties are not imported.'}

def run():
    global REFRESH
    parser=argparse.ArgumentParser();parser.add_argument('--publish',action='store_true');parser.add_argument('--refresh',action='store_true',help='Fetch new source responses instead of replaying cached request evidence.');args=parser.parse_args();REFRESH=args.refresh
    if args.publish:
        candidate=json.loads((ROOT/'data'/'candidate.json').read_text(encoding='utf-8'))
        path=PUBLIC/candidate['release_id']
        if not (path/'tiles-ready.json').exists():raise ValueError('Build vector tiles before activation')
        publish_release(PUBLIC,candidate,expected_count=candidate['expected_features'],actual_count=len(json.loads((path/'index.json').read_text(encoding='utf-8'))))
        print('Activated release '+candidate['release_id']);return
    features,profiles,metadata,count=import_parcels()
    sources=[];records=[];errors=[]
    for name,fn in [('dof_sales',import_sales),('acris',import_documents)]:
        try:
            imported,coverage=fn(profiles);records.extend(imported);sources.append(coverage)
        except Exception as e:
            print(name+' import unavailable: '+str(e),flush=True)
            errors.append({'source':name,'error':str(e)})
            sources.append({'id':name,'name':'DOF rolling sales' if name=='dof_sales' else 'ACRIS documents','status':'not_imported','note':'Extraction failed; no historical completeness is claimed.'})
    backfill_reports=[]
    try:
        backfilled,backfill_reports=backfill_documents(profiles,socrata)
        records=list({r['id']:r for r in [*records,*backfilled]}.values())
        acris=next((s for s in sources if s['id']=='acris'),None)
        if acris:
            acris['backfills']=backfill_reports
            acris['linked_records']=sum(r['type']=='document' for r in records)
            acris['note']+=' Exact-BBL historical metadata backfills from 1966 are also included for '+', '.join(r['address'] for r in backfill_reports)+'. See each property’s backfill coverage.'
    except Exception as e:errors.append({'source':'acris_backfill','error':str(e)});print('ACRIS backfill failed: '+str(e),flush=True)
    try:
        permits,permit_coverage=import_permits(profiles,socrata)
        records.extend(permits);sources.extend(permit_coverage)
    except Exception as e:errors.append({'source':'dob','error':str(e)});print('DOB import failed: '+str(e),flush=True)
    building_features={'type':'FeatureCollection','features':[]}
    try:
        building_features,building_coverage=import_buildings(profiles,socrata,BOUNDS)
        sources.append(building_coverage)
    except Exception as e:errors.append({'source':'oti_buildings','error':str(e)});print('Building import failed: '+str(e),flush=True)
    sources.append({'id':'nyc_aerial_2024','name':'NYC 2024 aerial imagery','agency':'NYC Office of Technology and Innovation','url':IMAGERY_URL,'status':'bounded','date_basis':'imagery_capture_year','source_edition':'2024','note':'Official NYC Orthos 2024 tile service; imagery is displayed directly from the agency service and is not archived by this import. Current parcel and building outlines are separate, independently dated datasets. This is an aerial view, not a current street photograph.'})
    if errors and (PUBLIC/'coverage.json').exists():
        raise RuntimeError('A historical source failed; preserving the last published release. See raw archives and the error output.')
    if (PUBLIC/'coverage.json').exists():
        prior=json.loads((PUBLIC/'coverage.json').read_text(encoding='utf-8'))
        if len(profiles)<prior['feature_count']*.95 or len(records)<prior['record_count']*.8:
            raise RuntimeError('Unexpected count drop; preserve the prior release and review source coverage before publishing.')
    stamp=datetime.now(timezone.utc).isoformat()
    content_hash=hashlib.sha256(json.dumps({'profiles':profiles,'records':records,'parser':PARSER_VERSION},sort_keys=True).encode()).hexdigest()
    release='bk-'+content_hash[:12]
    destination=PUBLIC/release
    private=ROOT/'data'/'releases'/release
    write_json(private/'geometry.geojson',{'type':'FeatureCollection','features':features})
    write_json(private/'buildings.geojson',building_features)
    by_bbl={b:[] for b in profiles}
    for record in records:
        record['release_id']=release
        for b in record['property_bbls']:
            if b in by_bbl:by_bbl[b].append(record)
    shards={}
    index=[]
    for b,p in profiles.items():
        p['backfill']=next((r for r in backfill_reports if r['bbl']==b),None)
        p['release_id']=release;p['history']=sorted(by_bbl[b],key=lambda r:(r.get('date') or r.get('recording_date') or '',r['id']),reverse=True)
        p['record_count']=len(p['history'])
        p['history_counts']={kind:sum(kind=='all' or r['type']==kind for r in p['history']) for kind in ('all','document','transfer','permit')}
        transfers=[r for r in p['history'] if r['type']=='transfer' and r.get('date')]
        p['latest_imported_transfer']=max((r['date'] for r in transfers),default=None)
        shards.setdefault(p['block'],{})[b]=p
        index.append({k:v for k,v in p.items() if k not in ('history','source_url','source_record_id','assess_land','historic_district','postal_code','floors','buildings','residential_units','backfill','building_records','building_crosscheck','assessment_calculation','assess_improvements')})
    for rows in shards.values():
        for b,p in rows.items():
            history=p.pop('history')
            write_json(destination/'profiles'/(b+'.json'),p)
            for kind in ('all','document','transfer','permit'):
                events=history if kind=='all' else [r for r in history if r['type']==kind]
                pages=list(batches(events,40))
                for page_number,page in enumerate(pages):
                    write_json(destination/'history'/b/kind/(str(page_number)+'.json'),{'release_id':release,'bbl':b,'events':page,'total':len(events),'next_page':page_number+1 if page_number+1<len(pages) else None})
    index.sort(key=lambda p:(p['address'],p['bbl']))
    write_json(destination/'index.json',index)
    write_json(private/'records.json',records)
    versions=sorted({p['source_edition'] for p in profiles.values() if p['source_edition']})
    source={'id':'mappluto','name':'MapPLUTO parcel footprints & attributes','agency':'NYC Department of City Planning','dataset':'DCP_GIS / MAPPLUTO','url':MAP_URL,
        'status':'bounded','source_edition':', '.join(versions),'source_updated_at':datetime.fromtimestamp(metadata['editingInfo']['dataLastEditDate']/1000,timezone.utc).isoformat(),
        'date_basis':'source_edition','linked_records':count,'note':'Geometry and attributes come from the same MapPLUTO edition. Assessment values are snapshot observations, not tax bills; assessment tax year is not supplied. Current geometry does not establish historic boundaries.'}
    manifest={'release_id':release,'storage_format':'paged-v1','parser_version':PARSER_VERSION,'fetched_at':stamp,'content_sha256':content_hash,'expected_features':count,'feature_count':count,
        'entity_count':len(profiles),'jurisdiction':'brooklyn','area_name':'DUMBO, Brooklyn Heights & Downtown Brooklyn','bounds':BOUNDS,
        'source_edition':', '.join(versions),'building_footprints':len(building_features['features']),'sources':[source,*sources], 'errors':errors,
        'limitations':['Bounded Brooklyn area; the rest of Brooklyn, NYC and New Jersey are not imported.','ACRIS history is a bounded association sample, with targeted older backfills on identified properties. It is not complete borough-wide history.','Condo billing footprints have no imported official unit crosswalk. Unit history is not inferred.','Annual sales backfill, annual assessment history, additional DOB categories and historical boundaries are not imported.','Bookmarks and notes are stored only in this browser. No multiuser authentication or server backup is enabled.'],
        'record_count':len(records),'condo_footprints':sum(p['entity_kind']=='billing_group' for p in profiles.values()),'multi_property_documents':sum(r['type']=='document' and len(r['property_bbls'])>1 for r in records)}
    write_json(destination/'manifest.json',manifest);write_json(ROOT/'data'/'candidate.json',manifest)
    write_json(private/'validation.json',{'valid':True,'expected_features':count,'actual_features':len(features),'unique_bbls':len(profiles),'records':len(records),'sources':sources,'errors':errors})
    print(json.dumps({'release_id':release,'features':count,'records':len(records),'condo_footprints':manifest['condo_footprints'],'multi_property_documents':manifest['multi_property_documents'],'next':'npm run tiles && python -m services.ingestion.import_pilot --publish'}),flush=True)

if __name__=='__main__':run()
