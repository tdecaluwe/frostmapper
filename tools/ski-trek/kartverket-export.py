"""Publish only independently checked native-data candidates and explicit gaps."""
from pathlib import Path
import base64,copy,hashlib,importlib.util,json,math,subprocess,sys,time,zlib,xml.etree.ElementTree as ET
import numpy as np
root=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(exist_ok=True,parents=True)
spec=importlib.util.spec_from_file_location('native_validation',Path(__file__).with_name('kartverket-validate.py'));validation=importlib.util.module_from_spec(spec);spec.loader.exec_module(validation)
terrain=validation.Terrain(root);meta=terrain.meta;all_status=[];profiles={}
profile_spec=importlib.util.spec_from_file_location('elevation_profile',Path(__file__).with_name('elevation-profile.py'));profile_module=importlib.util.module_from_spec(profile_spec);profile_spec.loader.exec_module(profile_module)
manifest_file=root/'published-routes.json'
if not manifest_file.exists():raise RuntimeError('Run kartverket-discover-minima.py before publishing')
manifest=json.loads(manifest_file.read_text())

def load(id,rank=1):
 key=f'{id}|{rank}'
 if key not in manifest:return None
 p=root/manifest[key]

 status=json.loads(p.read_text());all_status.append(status)
 if not status['feasible']:return None
 if not status.get('minimum_selection') or not status.get('local_refinement',{}).get('method','').startswith('whole-route'):
  raise RuntimeError('Run kartverket-discover-minima.py before publishing: candidate lacks whole-route minimum validation: '+str(p))
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
 properties={**status['validated'],'ascent_raw_m':status['validated']['ascent_m'],'descent_raw_m':status['validated']['descent_m'],'ascent_m':profile.ascent,'descent_m':profile.descent,'profile_id':id,'elevation_gain_method':profile.json()['method'],'corridor_constraints':status.get('corridor_constraints',[]),'constraint_checks':status.get('constraint_checks',[]),'id':id,'label':status.get('variant_label',label),'day':day,'start':status['start']['name'],'end':status['end']['name'],'cost_penalty_multiplier':status['weight'],'slope_cap_deg':status['cap'],'source':'Kartverket NHM DTM 1 m','heading_scale_m':10,'search_mesh_m':status['mesh_m'],'endpoint_refinement_m':status.get('endpoint_refinement_m',250),'native_validated':True,'diagnostic':False,'local_optimum':status.get('local_refinement'),'geographic_diversity':status.get('geographic_diversity'),'minimum_selection':status.get('minimum_selection'),'minimum_id':hashlib.sha256(min(points.tobytes(),points[::-1].tobytes())).hexdigest()[:16]}
 if any(c['name']=='Climb toward Istjønna' for c in status.get('constraint_checks',[])):
  first=next(c for c in status['constraint_checks'] if c['name']=='Climb toward Istjønna');properties['initial_climb_toward_istjonna_m']=xy[first['path_index']][2]-xy[0][2]
  assert properties['initial_climb_toward_istjonna_m']>50
 if any(c['name']=='Midthøa' for c in status.get('constraint_checks',[])):
  properties['midthoa_distance_m']=next(c for c in status['constraint_checks'] if c['name']=='Midthøa')['minimum_distance_m'];assert properties['midthoa_distance_m']<=1000
 return dict(type='Feature',properties=properties,geometry=dict(type='LineString',coordinates=coords))

def ranks(leg):
 return sorted(int(key.split('|')[1]) for key in manifest if key.split('|')[0]==leg)

options=[]
for rank in ranks('D1'):
 status=load('D1',rank)
 if status:options.append(feature(status,f'1{chr(96+rank)}','Terrain-cost minimum',1))
features=[copy.deepcopy(options[0])] if options else []
additional=[]
for day in range(2,6):
 for rank in ranks(f'D{day}'):
  status=load(f'D{day}',rank)
  if not status:continue
  f=feature(status,str(day) if rank==1 else f'D{day}{chr(64+rank)}','Terrain-cost minimum',day)
  (features if rank==1 else additional).append(f)
returns=[]
for rank in ranks('R'):
 status=load('R',rank)
 if status:
  reverse=feature(status,'R' if rank==1 else 'R'+chr(68+rank),'Reverse of outward minimum',6)
  reverse['properties'].update(retrace=True,shares_outward_corridor=rank==1);returns.append(reverse)
if returns:features.append(copy.deepcopy(returns[0]))
diagnostics=[]
for leg in ['VP','VJ','JM']:
 for rank in ranks(leg):
  status=load(leg,rank)
  if status:additional.append(feature(status,leg if rank==1 else leg+chr(64+rank),'Terrain-cost minimum',0))
for f in additional:f['properties'].update(standalone=True,download=f"additional-{f['properties']['id']}.gpx")
for f in diagnostics:f['properties']['download']=f"kartverket-{f['properties']['id']}.gpx"
complete=sorted(f['properties']['day'] for f in features)==list(range(1,7))
warning='Kartverket 1 m terrain checks; fall-line direction measured across 10 m. Planning candidates, not field-verified tracks.'
if options and max(f['properties']['max_slope_deg'] for f in options)>20:warning+=' Day 1 exceeds the requested 20-degree preference; inspect its reported native terrain maximum.'
if not options:warning+=' Day 1 to Veltdalshytta remains unresolved; the available legs do not form a complete itinerary.'
under20='The earlier sub-20° search to Torsbu found no verified candidate; no such option is claimed by this minimum search.'
method=dict(objective='Horizontal distance weighted by 1 + P*(10*grade + 6**(5*grade-1) - 1/6), grade=tan(terrain slope), P=1 for every published minimum. No low-slope cutoff.',cost_penalty_multipliers=[1],candidate_policy='Unpinned whole-route shortest-cost descent in a recentered sparse corridor: 600 m coarse / 20 m fine, certified finally at 1200 m coarse / 60 m fine. No length constraint or distance pressure during descent. Named regions are seeds only. Accept <=2 times the shortest converged minimum length and <=1.35 times the best eligible minimum cost. Alternatives require symmetric separation over >=15% of each route and a continuous run >=max(750 m,12% of reference length), at separation max(150 m,min(500 m,2.5% of reference length)).',source='Kartverket NHM DTM, nhm_dtm_topo_25832, EPSG:25832, native 1 m grid',heading_rule='On the 10 m gradient field above 10 degrees, deviation from uphill/downhill fall line <= 90 - 3*slope degrees.',heading_scale_m=10,grid='Sparse 4 m corridor plus 1 m band around the complete route, including endpoints. Every edge checked against native 1 m slope and 10 m heading fields.',validation='Independent exact segment/cell integration, recomputing gradients from cached float elevations. Reported slope figures describe this terrain model.',limits=dict(maximum_length_ratio=2,reference='Shortest converged local minimum found for the same endpoints, before geographic/cost filtering',maximum_cost_ratio=1.35),day1_under20=under20,scope='Terrain-only ground model; snow cover, ice and avalanche exposure are not modeled. Discrete finite-coverage candidates, not proven global optima.')
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
summary=dict(minimum_discovery=json.loads((root/'minimum-summary.json').read_text()) if (root/'minimum-summary.json').exists() else [],geographic_selection=json.loads((root/'geographic-summary.json').read_text()) if (root/'geographic-summary.json').exists() else [],under20_repair=json.loads((root/'torsbu-under20-repair.json').read_text()) if (root/'torsbu-under20-repair.json').exists() else None,method=method,plan_complete=complete,routes=[f['properties'] for f in features],options=[f['properties'] for f in options],returns=[f['properties'] for f in returns],diagnostics=[f['properties'] for f in diagnostics],additional=[f['properties'] for f in additional],searches=[{k:v for k,v in s.items() if k in ['id','variant_id','pathfile','seed','validated','local_refinement','local_refinement_seconds','terrain_revision','minimum_selection','weight','cap','mesh_m']} for s in all_status],terrain_tiles=len(list((root/'terrain').glob('*.done'))))
(out/'kartverket-analysis.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
# Preserve shortest-found references even when their basin representative is a
# slightly longer, cheaper route. Fresh workspaces must not forget them.
references=[]
for report in summary['minimum_discovery']:
 shortest=min(report['converged'],key=lambda s:s['distance_km']);points=np.fromfile(root/shortest['pathfile'],np.int32).reshape(-1,2);delta=np.diff(points,axis=0)
 assert np.max(np.abs(delta))<=127
 status=json.loads((root/manifest[report['leg']+'|1']).read_text())
 references.append(dict(leg=report['leg'],start=status['start']['name'],end=status['end']['name'],anchor=points[0].tolist(),deltas=base64.b64encode(zlib.compress(delta.astype(np.int8).tobytes())).decode(),sha256=hashlib.sha256(points.astype('<i4',copy=False).tobytes()).hexdigest(),distance_km=shortest['distance_km'],cost_m=shortest['cost_m']))
(out/'minimum-reference-seeds.json').write_text(json.dumps(dict(grid={k:meta[k] for k in ['crs','resolution','xmin','ymax','width','height']},encoding='zlib-base64-int8-row-col-deltas',purpose='Reference minima retained as search seeds, not additional displayed route options. Revalidate and refine before reuse.',seeds=references),ensure_ascii=False,separators=(',',':')))
print(json.dumps(dict(complete=complete,days=[(f['properties']['day'],f['properties']['distance_km'],f['properties']['max_slope_deg']) for f in features],options=len(options),returns=len(returns),diagnostics=len(diagnostics),additional=len(additional)),ensure_ascii=False))
