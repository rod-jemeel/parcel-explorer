"""Official OTI building footprints and source-supplied parcel associations."""
import hashlib
import json

URL='https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue'
IMAGERY_URL='https://www.arcgis.com/home/item.html?id=423f15185bd04f8dad8d99fba736772f'

def normalize_building(row,profiles):
    mapped=str(row.get('mappluto_bbl') or '').strip();base=str(row.get('base_bbl') or '').strip()
    if mapped in profiles:bbl=mapped;association='official_mappluto_bbl'
    elif base in profiles:bbl=base;association='official_base_bbl'
    else:return None
    raw_bin=str(row.get('bin') or '').split('.')[0]
    bin_value=raw_bin if len(raw_bin)==7 and raw_bin.isdigit() and raw_bin[1:]!='000000' else None
    year=row.get('construction_year')
    return {'id':'oti:'+str(row['doitt_id']),'source_record_id':str(row['doitt_id']),'source':'oti_buildings',
        'bbl':bbl,'base_bbl':base,'mappluto_bbl':mapped,'bin':bin_value,'name':row.get('name'),
        'construction_year':int(year) if year and str(year).isdigit() and int(year)>0 else None,
        'last_edited_at':row.get('last_edited_date'),'source_status':row.get('last_status_type'),
        'association':association,'geometry':row.get('the_geom'),'official_url':URL,
        'raw_record_hash':hashlib.sha256(json.dumps(row,sort_keys=True).encode()).hexdigest()}

def import_buildings(profiles,socrata,bounds):
    where=f'within_box(the_geom,{bounds[3]},{bounds[0]},{bounds[1]},{bounds[2]})'
    expected=int(socrata('5zhs-2jue',{'$select':'count(*)','$where':where})[0]['count'])
    rows=[]
    for offset in range(0,expected,2000):
        rows.extend(socrata('5zhs-2jue',{'$where':where,'$order':'doitt_id','$limit':2000,'$offset':offset}))
    after=int(socrata('5zhs-2jue',{'$select':'count(*)','$where':where})[0]['count'])
    if len(rows)!=expected or after!=expected:raise ValueError('Building footprint extraction count drift')
    by_bbl={};features=[];unmatched=0;seen=set()
    for row in rows:
        r=normalize_building(row,profiles)
        if not r:unmatched+=1;continue
        if r['id'] in seen:raise ValueError('Duplicate OTI building ID needs review')
        seen.add(r['id']);by_bbl.setdefault(r['bbl'],[]).append(r)
        if r['geometry']:features.append({'type':'Feature','geometry':r['geometry'],'properties':{'id':r['id'],'bbl':r['bbl'],'bin':r['bin'] or ''}})
    for bbl,p in profiles.items():
        records=by_bbl.get(bbl,[]);bins={r['bin'] for r in records if r['bin']};reported=p.get('buildings')
        complete_bins=bool(records) and all(r['bin'] for r in records)
        p['building_records']=records
        p['building_crosscheck']={'footprints':len(records),'distinct_bins':len(bins),'pluto_reported_buildings':reported,
            'status':'count_agrees' if complete_bins and reported==len(bins) else 'count_differs' if complete_bins and reported is not None else 'unresolved',
            'note':'Exact source-supplied MapPLUTO BBL or base BBL association. Footprint and PLUTO editions may differ; edge-of-import buildings can be outside footprint coverage. A count agreement is not a physical inspection or verification of present condition.'}
    print(f'  OTI buildings: {len(features)} linked footprints; {unmatched} rows outside imported parcel identities',flush=True)
    return {'type':'FeatureCollection','features':features},{'id':'oti_buildings','name':'OTI building footprints','agency':'NYC Office of Technology and Innovation','dataset':'5zhs-2jue','url':URL,'status':'bounded','date_basis':'source_observation','source_rows':len(rows),'linked_records':len(features),'unmatched_rows':unmatched,
        'note':'Official building outlines selected within the pilot rectangle. Buildings link only by supplied MapPLUTO BBL or base BBL. BINs, construction years and footprint edit timestamps are retained. No inferred unit associations or per-building assessment allocation.'}
