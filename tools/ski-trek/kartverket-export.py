"""Publish only independently checked native-data candidates and explicit gaps."""
from pathlib import Path
import copy,importlib.util,json,math,subprocess,sys,time,xml.etree.ElementTree as ET
import numpy as np
root=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(exist_ok=True,parents=True)
spec=importlib.util.spec_from_file_location('native_validation',Path(__file__).with_name('kartverket-validate.py'));validation=importlib.util.module_from_spec(spec);spec.loader.exec_module(validation)
terrain=validation.Terrain(root);meta=terrain.meta;all_status=[];profiles={}
profile_spec=importlib.util.spec_from_file_location('elevation_profile',Path(__file__).with_name('elevation-profile.py'));profile_module=importlib.util.module_from_spec(profile_spec);profile_spec.loader.exec_module(profile_module)
manifest=json.loads((root/'published-routes.json').read_text()) if (root/'published-routes.json').exists() else None

def load(id,grade=1,cap=29.5,mesh=4):
 p=root/f'{id}-le2-p250-h10-cap{cap}-w{grade}-m{mesh}.json'
 if manifest is not None:
  key=f'{id}|{grade}'
  if key not in manifest:return None
  p=root/manifest[key]
 if not p.exists():return None
 status=json.loads(p.read_text());all_status.append(status)
 if not status['feasible']:return None
 if 'max_heading_slope_deg' not in status.get('validated',{}):
  status['validated']=validation.validate(terrain,root/status['pathfile'],status['cap'],status['weight']);p.write_text(json.dumps(status,indent=2,ensure_ascii=False))
 return status

def feature(status,id,label,day):
 points=np.fromfile(root/status['pathfile'],np.int32).reshape(-1,2)
 xy=[(meta['xmin']+int(c)+.5,meta['ymax']-int(r)-.5,terrain.height(int(r),int(c))) for r,c in points]
 lines=''.join(f'{x} {y} {h}\n' for x,y,h in xy)
 coords=[list(map(float,line.split())) for line in subprocess.check_output(['gdaltransform','-s_srs','EPSG:25832','-t_srs','EPSG:4326'],input=lines.encode()).decode().splitlines()]
 id=status.get('variant_id',id)
 distance=np.r_[0,np.cumsum(np.hypot(*np.diff(points,axis=0).T))];profile=profile_module.ElevationProfile(distance,[p[2] for p in xy]);profiles[id]=profile.json()
 properties={**status['validated'],'ascent_raw_m':status['validated']['ascent_m'],'descent_raw_m':status['validated']['descent_m'],'ascent_m':profile.ascent,'descent_m':profile.descent,'profile_id':id,'elevation_gain_method':profile.json()['method'],'corridor_constraints':status.get('corridor_constraints',[]),'constraint_checks':status.get('constraint_checks',[]),'id':id,'label':status.get('variant_label',label),'day':day,'start':status['start']['name'],'end':status['end']['name'],'cost_penalty_multiplier':status['weight'],'slope_cap_deg':status['cap'],'source':'Kartverket NHM DTM 1 m','heading_scale_m':10,'search_mesh_m':status['mesh_m'],'endpoint_refinement_m':status.get('endpoint_refinement_m',250),'native_validated':True,'diagnostic':False,'local_optimum':status.get('local_refinement'),'geographic_diversity':status.get('geographic_diversity')}
 if any(c['name']=='Climb toward Istjønna' for c in status.get('constraint_checks',[])):
  first=next(c for c in status['constraint_checks'] if c['name']=='Climb toward Istjønna');properties['initial_climb_toward_istjonna_m']=xy[first['path_index']][2]-xy[0][2]
  assert properties['initial_climb_toward_istjonna_m']>50
 if any(c['name']=='Midthøa' for c in status.get('constraint_checks',[])):
  properties['midthoa_distance_m']=next(c for c in status['constraint_checks'] if c['name']=='Midthøa')['minimum_distance_m'];assert properties['midthoa_distance_m']<=1000
 return dict(type='Feature',properties=properties,geometry=dict(type='LineString',coordinates=coords))

options=[]
for g,id,label in [(1,'K1','Specified linear + exponential formula'),(2,'K2','Double terrain penalty')]:
 status=load('D1',g) or load('D1',g,cap=45)
 if status and status['cap']>29.5:label='Steeper native candidate; '+label
 if status:options.append(feature(status,id,label,1))
features=[copy.deepcopy(options[0])] if options else []
additional=[]
for day in range(2,6):
 status=load(f'D{day}')
 if status:features.append(feature(status,str(day),'Specified cost formula',day))
 other=load(f'D{day}',2)
 if other:
  f=feature(other,f'D{day}B',f'Day {day}: stronger terrain avoidance',day);additional.append(f)
returns=[]
fifth=next((f for f in features if f['properties']['day']==5),None)
native_return=load('R') if manifest is not None else None
if native_return:
 reverse=feature(native_return,'R',native_return.get('variant_label','Return in outward corridor'),6);reverse['properties']['retrace']=native_return.get('retrace',False);reverse['properties']['shares_outward_corridor']=native_return.get('shares_outward_corridor',True);returns.append(reverse)
elif fifth:
 reverse=copy.deepcopy(fifth);reverse['geometry']['coordinates'].reverse();p=reverse['properties'];p.update(day=6,id='R',label='Reverse of day 5',retrace=True);p['start'],p['end']=p['end'],p['start'];p['ascent_m'],p['descent_m']=p['descent_m'],p['ascent_m'];returns.append(reverse)
for id,grade,label in [('RF',1,'Different lower-valley return'),('RG',2,'Different return; stronger terrain avoidance')]:
 status=load(id,grade)
 if status:returns.append(feature(status,id,label,6))
if returns:features.append(copy.deepcopy(next((f for f in returns if f['properties']['id']=='RF'),returns[0])))
diagnostics=[]
for id,label in [('T25','Sub-20° to Torsbu, within 25 km'),('T35','Sub-20° to Torsbu, extended day')]:
 status=load(id,cap=20) or load(id,cap=20,mesh=2)
 if status:
  f=feature(status,id,label,1);f['properties'].update(diagnostic=True,different_endpoint=True,over_daily_limit=status['validated']['distance_km']>25);diagnostics.append(f)
for leg in ['VP','VJ','JM']:
 for grade,id in [(1,leg),(2,leg+'B')]:
  status=load(leg,grade)
  if status:additional.append(feature(status,id,'Direct: '+('Specified cost formula' if grade==1 else 'stronger terrain avoidance'),0))
for f in additional:f['properties'].update(standalone=True,download=f"additional-{f['properties']['id']}.gpx")
for f in diagnostics:f['properties']['download']=f"kartverket-{f['properties']['id']}.gpx"
complete=sorted(f['properties']['day'] for f in features)==list(range(1,7))
warning='Kartverket 1 m terrain checks; fall-line direction measured across 10 m. Planning candidates, not field-verified tracks.'
if options and max(f['properties']['max_slope_deg'] for f in options)>20:warning+=' Day 1 exceeds the requested 20-degree preference; inspect its reported native terrain maximum.'
if not options:warning+=' Day 1 to Veltdalshytta remains unresolved; the available legs do not form a complete itinerary.'
under20='No sub-20° candidate to Torsbu was found in the tested search. This is not proof that no route exists.' if not diagnostics else 'Separate sub-20° candidates end at Torsbu, not Veltdalshytta. Extended variants exceed the 25 km daily limit.'
method=dict(objective='Horizontal distance weighted by 1 + P*(10*grade + 6**(5*grade-1) - 1/6), grade=tan(terrain slope), P=1 default or 2 for stronger avoidance. No low-slope cutoff.',cost_penalty_multipliers=[1],candidate_policy='One objective for all candidates. Local rerouting of 1 km windows in a 300 m neighborhood; retain geographically distinct basins, not weight variants.',source='Kartverket NHM DTM, nhm_dtm_topo_25832, EPSG:25832, native 1 m grid',heading_rule='On the 10 m gradient field above 10 degrees, deviation from uphill/downhill fall line <= 90 - 3*slope degrees.',heading_scale_m=10,grid='4 m mesh; endpoint neighborhoods refined at 1 m; every edge checked against native 1 m slope and 10 m heading fields.',validation='Independent exact segment/cell integration, recomputing gradients from cached float elevations. Reported slope figures describe this terrain model.',limits=dict(preferred_km=18,maximum_km=25,return_alternative_maximum_km=35),day1_under20=under20,scope='Terrain-only ground model; snow cover, ice and avalanche exposure are not modeled. Discrete finite-coverage candidates, not proven global optima.')
data=dict(type='FeatureCollection',name='Tafjord ski trek — native Kartverket terrain candidates',plan_complete=complete,method=method,profiles=profiles,terrain_validation=dict(warning=warning,status='Kartverket 1 m · 10 m fall-line scale'+(' · day 1 unresolved' if not complete else ''),report='kartverket-analysis.json',rejected_route_ids=['C','E']),features=features,day1_options=options,day6_options=returns,diagnostics=diagnostics,additional_routes=additional)
(out/'exposure-routes.geojson').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
ns='http://www.topografix.com/GPX/1/1';ET.register_namespace('',ns)
def gpx(items,name):
 doc=ET.Element('{'+ns+'}gpx',version='1.1',creator='Frostmapper Kartverket native terrain routing')
 metadata=ET.SubElement(doc,'{'+ns+'}metadata');ET.SubElement(metadata,'{'+ns+'}desc').text=warning
 for f in items:
  p=f['properties'];track=ET.SubElement(doc,'{'+ns+'}trk');ET.SubElement(track,'{'+ns+'}name').text=f"{p['id']}: {p['start']} – {p['end']}"
  ET.SubElement(track,'{'+ns+'}desc').text=f"{p['label']}; native 1 m DTM; 10 m fall-line field; {p['distance_km']:.3f} km; {p['max_slope_deg']:.2f} deg model max. Terrain-model candidate, not field verified."
  segment=ET.SubElement(track,'{'+ns+'}trkseg')
  for lon,lat,h in f['geometry']['coordinates']:
   point=ET.SubElement(segment,'{'+ns+'}trkpt',lon=repr(lon),lat=repr(lat));ET.SubElement(point,'{'+ns+'}ele').text=repr(h)
 ET.ElementTree(doc).write(out/name,encoding='utf-8',xml_declaration=True)
gpx(features,'exposure-trek.gpx');gpx(options,'day1-exposure-options.gpx');gpx(returns,'return-exposure-options.gpx');gpx(additional,'additional-route-options.gpx')
for f in diagnostics+additional:gpx([f],f['properties']['download'])
summary=dict(geographic_selection=json.loads((root/'geographic-summary.json').read_text()) if (root/'geographic-summary.json').exists() else [],under20_repair=json.loads((root/'torsbu-under20-repair.json').read_text()) if (root/'torsbu-under20-repair.json').exists() else None,method=method,plan_complete=complete,routes=[f['properties'] for f in features],options=[f['properties'] for f in options],returns=[f['properties'] for f in returns],diagnostics=[f['properties'] for f in diagnostics],additional=[f['properties'] for f in additional],searches=[{k:v for k,v in s.items() if k not in ['stderr','start','end']} for s in all_status],terrain_tiles=len(list((root/'terrain').glob('*.done'))))
(out/'kartverket-analysis.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(complete=complete,days=[(f['properties']['day'],f['properties']['distance_km'],f['properties']['max_slope_deg']) for f in features],options=len(options),returns=len(returns),diagnostics=len(diagnostics),additional=len(additional)),ensure_ascii=False))
