"""Loopback-only read API over the immutable pilot release.

This adapter is deliberately separate from the production PostGIS/auth path.
It has no user-data or admin writes and must not be exposed as a hosted API.
"""
from __future__ import annotations
import base64
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
from typing import Annotated
from fastapi import FastAPI, HTTPException, Query, Path as APIPath
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

ROOT=Path(__file__).resolve().parents[2]
DEFAULT_DATA=ROOT/'apps'/'web'/'public'/'data'

def fingerprint(state):
    return hashlib.sha256(json.dumps(state,sort_keys=True,separators=(',',':')).encode()).hexdigest()[:24]

def cursor_encode(offset,scope):
    return base64.urlsafe_b64encode(json.dumps({'offset':offset,'scope':scope}).encode()).decode().rstrip('=')

def cursor_offset(cursor,scope):
    if not cursor:return 0
    try:
        value=json.loads(base64.urlsafe_b64decode(cursor+'='*((-len(cursor))%4)))
        if value['scope']!=scope or type(value['offset']) is not int or not 0<=value['offset']<=100000:raise ValueError()
        return value['offset']
    except Exception:raise HTTPException(400,detail={'code':'cursor_scope_mismatch','message':'Cursor must match the exact query and release.'})

def create_app(data_root:Path=DEFAULT_DATA):
    app=FastAPI(title='Parcel Explorer local pilot',version='0.1.0',description='Read-only local snapshot API. No network deployment or multiuser authentication is enabled.')
    app.add_middleware(CORSMiddleware,allow_origins=['http://127.0.0.1:3100','http://localhost:3100'],allow_methods=['GET'],allow_headers=[])

    @app.middleware('http')
    async def local_requests_only(request,call_next):
        if request.client and request.client.host not in ('127.0.0.1','::1','testclient'):
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=403,content={'detail':{'code':'local_only','message':'The pilot API accepts loopback clients only.'}})
        return await call_next(request)

    def read(path):
        try:return json.loads(path.read_text(encoding='utf-8'))
        except FileNotFoundError:raise HTTPException(503,detail={'code':'release_not_published','message':'Run the importer, build tiles, and publish a validated release.'})

    def coverage():return read(data_root/'coverage.json')

    def release_path(release):
        active=coverage()['release_id']
        if not re.fullmatch(r'bk-[a-f0-9]{12}',release) or release!=active:
            raise HTTPException(410,detail={'code':'data_release_unavailable','active_release_id':active})
        return data_root/release

    @lru_cache(maxsize=4)
    def index_for(path):return read(path/'index.json')

    def get_property(identifier,release):
        path=release_path(release)
        summary=next((p for p in index_for(path) if p['bbl']==identifier or p['id']==identifier),None)
        if summary is None:raise HTTPException(404,detail={'code':'property_not_imported'})
        return read(path/'profiles'/(summary['bbl']+'.json'))

    @app.get('/api/v1/coverage')
    def get_coverage():return coverage()

    @app.get('/api/v1/search')
    @app.get('/api/v1/properties')
    def search(release_id:str,q:Annotated[str,Query(max_length=200)]='',
               uses:Annotated[str,Query(max_length=50)]='',
               min_lot:Annotated[float|None,Query(ge=0)]=None,max_lot:Annotated[float|None,Query(ge=0)]=None,
               min_year:Annotated[int|None,Query(ge=0)]=None,max_year:Annotated[int|None,Query(ge=0)]=None,
               min_assessment:Annotated[float|None,Query(ge=0)]=None,max_assessment:Annotated[float|None,Query(ge=0)]=None,
               has_records:bool=False,include_unknown:bool=False,bounds:Annotated[str|None,Query(max_length=100)]=None,
               sort:Annotated[str,Query(pattern='^(relevance|address|lot_desc|assessment_desc)$')]='relevance',
               limit:Annotated[int,Query(ge=1,le=100)]=40,cursor:Annotated[str|None,Query(max_length=400)]=None):
        path=release_path(release_id);use_list=sorted(set(uses.split(','))-{''})
        if any(x not in {str(i) for i in range(1,12)} for x in use_list):raise HTTPException(422,detail={'code':'invalid_land_use'})
        box=None
        if bounds:
            try:
                box=list(map(float,bounds.split(',')))
                if len(box)!=4 or not (-180<=box[0]<box[2]<=180 and -85<=box[1]<box[3]<=85):raise ValueError()
            except ValueError:raise HTTPException(422,detail={'code':'invalid_bounds'})
        ranges=[('lot_area',min_lot,max_lot),('year_built',min_year,max_year),('assess_total',min_assessment,max_assessment)]
        if any(lo is not None and hi is not None and lo>hi for _,lo,hi in ranges):raise HTTPException(422,detail={'code':'inverted_range'})
        state={'q':q.strip(),'uses':use_list,'ranges':ranges,'bounds':box,'has_records':has_records,'include_unknown':include_unknown,'sort':sort,'release_id':release_id}
        scope=fingerprint(state);offset=cursor_offset(cursor,scope)
        unsupported=bool(re.search(r'\b(new jersey|jersey city|hudson|manhattan|queens|bronx|staten island|hoboken|newark|albany)\b',q,re.I))
        is_place=q.lower().strip() in ('brooklyn','kings county','brooklyn ny','brooklyn, ny','dumbo','brooklyn heights','downtown brooklyn')
        clean=lambda s:' '.join(re.sub(r'[.,]',' ',s.upper()).split())
        query=clean(q);words=query.split()
        def matches(p):
            if unsupported:return False
            if query and not is_place and p['bbl']!=query and not all(w in clean(p['address']) for w in words):return False
            if use_list and p.get('land_use') not in use_list:return False
            for key,lo,hi in ranges:
                if lo is None and hi is None:continue
                value=p.get(key)
                if value is None:
                    if not include_unknown:return False
                    continue
                n=float(value)
                if lo is not None and n<lo or hi is not None and n>hi:return False
            if has_records and not p.get('record_count'):return False
            if box:
                b=p['bounds']
                if b[2]<box[0] or b[0]>box[2] or b[3]<box[1] or b[1]>box[3]:return False
            return True
        results=[p for p in index_for(path) if matches(p)]
        def key(p):
            address=re.sub(r'\d+',lambda m:m.group().zfill(12),p['address'].upper())
            rank=0 if p['bbl']==query else 1 if clean(p['address'])==query else 2 if clean(p['address']).startswith(query) else 3
            prefix=rank if sort=='relevance' and query and not is_place else -(p.get('lot_area') or -1) if sort=='lot_desc' else -float(p.get('assess_total') or -1) if sort=='assessment_desc' else 0
            return prefix,address,p['bbl']
        results.sort(key=key)
        return {'release_id':release_id,'query_fingerprint':scope,'applied_state':state,'total':len(results),'count_kind':'exact_imported_entities','footprint_count':len(results),'coverage_status':'outside_coverage' if unsupported else 'bounded','results':results[offset:offset+limit],'next_cursor':cursor_encode(offset+limit,scope) if offset+limit<len(results) else None}

    @app.get('/api/v1/search/suggestions')
    def suggestions(release_id:str,q:Annotated[str,Query(max_length=200)]=''):
        path=release_path(release_id);query=q.upper().strip()
        rows=[p for p in index_for(path) if p['bbl']==query or query in p['address'].upper()]
        rows.sort(key=lambda p:(p['bbl']!=query,p['address']!=query,p['address']))
        return {'release_id':release_id,'results':[{'type':'property',**p} for p in rows[:8]]}

    @app.get('/api/v1/properties/{identifier}')
    def profile(identifier:str,release_id:str):
        p=get_property(identifier,release_id)
        return {k:v for k,v in p.items() if k!='history'}

    @app.get('/api/v1/properties/{identifier}/history')
    def history(identifier:str,release_id:str,limit:Annotated[int,Query(ge=1,le=100)]=40,cursor:Annotated[str|None,Query(max_length=400)]=None):
        p=get_property(identifier,release_id);scope=fingerprint([release_id,p['bbl'],'history']);offset=cursor_offset(cursor,scope)
        if p.get('record_count')==0:
            return {'release_id':release_id,'events':[],'total':0,'coverage_status':'partial','next_cursor':None}
        directory=release_path(release_id)/'history'/p['bbl']/'all'
        first=read(directory/'0.json');total=first['total'];rows=[]
        for page_number in range(offset//40,min((offset+limit-1)//40,total//40)+1):
            if page_number*40>=total:break
            rows.extend(read(directory/(str(page_number)+'.json'))['events'])
        start=offset%40
        return {'release_id':release_id,'events':rows[start:start+limit],'total':total,'coverage_status':'partial','next_cursor':cursor_encode(offset+limit,scope) if offset+limit<total else None}

    @app.get('/api/v1/properties/{identifier}/relationships')
    def relationships(identifier:str,release_id:str):
        p=get_property(identifier,release_id)
        return {'release_id':release_id,'relationships':[],'status':p.get('relationships_status','not_imported'),'note':'No official unit or lineage crosswalk is imported. Do not infer unit history from a shared footprint.'}

    @app.get('/api/v1/sources/{source_id}')
    def source(source_id:str,release_id:str):
        release_path(release_id)
        s=next((s for s in coverage()['sources'] if s['id']==source_id),None)
        if s is None:raise HTTPException(404,detail={'code':'source_not_imported'})
        return {'release_id':release_id,**s}

    @app.get('/tiles/{release_id}/{z}/{x}/{y}.pbf')
    def tile(release_id:str,z:Annotated[int,APIPath(ge=13,le=16)],x:int,y:int):
        path=release_path(release_id)/'tiles'/str(z)/str(x)/(str(y)+'.pbf')
        if not 0<=x<2**z or not 0<=y<2**z:raise HTTPException(422,detail={'code':'invalid_tile_coordinates'})
        if not path.exists():
            from fastapi.responses import Response
            return Response(content=b'',media_type='application/vnd.mapbox-vector-tile')
        return FileResponse(path,media_type='application/vnd.mapbox-vector-tile',headers={'Cache-Control':'private, max-age=31536000, immutable'})

    return app

app=create_app()
