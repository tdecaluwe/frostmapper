"""Generate unrestricted seeds, descend basins, then select relative alternatives.
Run after terrain/heading preparation and compilation of search and basin.
"""
from pathlib import Path
import base64,hashlib,importlib.util,json,subprocess,sys,time,zlib
import numpy as np
spec=importlib.util.spec_from_file_location('minimum',Path(__file__).with_name('kartverket-minima.py'));minimum=importlib.util.module_from_spec(spec);spec.loader.exec_module(minimum)

class MinimumDiscovery:
 def __init__(self,root):
  self.root=Path(root);self.refiner=minimum.BasinRefiner(root);self.meta=self.refiner.meta
  if not (self.root/'huts.json').exists():self.bootstrap_huts()
  self.huts=json.loads((self.root/'huts.json').read_text())
  if not (self.root/'published-routes.json').exists():self.bootstrap_routes()
  self.previous=json.loads((self.root/'published-routes.json').read_text());self.manifest={};self.report=[]
 def project(self,coordinates):
  text=''.join(' '.join(map(str,p[:2]))+'\n' for p in coordinates)
  xy=np.loadtxt(subprocess.check_output(['gdaltransform','-s_srs','EPSG:4326','-t_srs','EPSG:25832'],input=text.encode()).decode().splitlines())
  return np.column_stack([np.rint(self.meta['ymax']-xy[:,1]-.5),np.rint(xy[:,0]-self.meta['xmin']-.5)]).astype(np.int32)
 def bootstrap_huts(self):
  repo=Path(__file__).resolve().parents[2];huts=json.loads((repo/'data/ski-trek/huts.json').read_text());points=self.project([[h['lon'],h['lat']] for h in huts])
  for h,(r,c) in zip(huts,points):h.update(row=int(r),col=int(c))
  (self.root/'huts.json').write_text(json.dumps(huts,ensure_ascii=False,indent=2))
 def bootstrap_routes(self):
  repo=Path(__file__).resolve().parents[2];data=json.loads((repo/'data/ski-trek/exposure-routes.geojson').read_text());manifest={};seen=set();huts={h['name']:h for h in self.huts}
  for key in ('features','day1_options','day6_options','additional_routes'):
   for f in data[key]:
    p=f['properties'];id=p['id']
    if id in seen:continue
    seen.add(id);day=p['day'];leg='D'+str(day) if 1<=day<=5 else 'R' if day==6 else next((name for name in ['VP','VJ','JM'] if id.startswith(name)),None)
    if not leg:continue
    points=self.project(f['geometry']['coordinates']);path=self.root/f'bootstrap-{id}.bin';points.tofile(path)
    start=dict(huts[p['start']]);end=dict(huts[p['end']]);start.update(row=int(points[0,0]),col=int(points[0,1]));end.update(row=int(points[-1,0]),col=int(points[-1,1]))
    file=self.root/f'bootstrap-{id}.json';file.write_text(json.dumps(dict(id=leg,feasible=True,pathfile=path.name,start=start,end=end,cap=45,weight=1,mesh_m=4),ensure_ascii=False,indent=2));rank=1+sum(k.startswith(leg+'|') for k in manifest);manifest[f'{leg}|{rank}']=file.name
  archive=repo/'data/ski-trek/minimum-reference-seeds.json'
  if archive.exists():
   history=json.loads(archive.read_text())
   if history['encoding']!='zlib-base64-int8-row-col-deltas' or any(self.meta[k]!=v for k,v in history['grid'].items()):raise RuntimeError('Reference seed grid/encoding mismatch')
   for record in history['seeds']:
    anchor=np.array(record['anchor'],np.int32);delta=np.frombuffer(zlib.decompress(base64.b64decode(record['deltas'])),np.int8).reshape(-1,2);points=np.vstack([anchor,anchor+np.cumsum(delta,axis=0,dtype=np.int32)])
    if hashlib.sha256(points.astype('<i4',copy=False).tobytes()).hexdigest()!=record['sha256']:raise RuntimeError('Reference seed checksum mismatch')
    leg=record['leg'];path=self.root/f'bootstrap-reference-{leg}.bin';points.tofile(path);start=dict(huts[record['start']]);end=dict(huts[record['end']]);start.update(row=int(points[0,0]),col=int(points[0,1]));end.update(row=int(points[-1,0]),col=int(points[-1,1]))
    file=self.root/f'bootstrap-reference-{leg}.json';file.write_text(json.dumps(dict(id=leg,feasible=True,pathfile=path.name,start=start,end=end,cap=45,weight=1,mesh_m=4),ensure_ascii=False,indent=2));rank=1+sum(k.startswith(leg+'|') for k in manifest);manifest[f'{leg}|{rank}']=file.name
  (self.root/'published-routes.json').write_text(json.dumps(manifest,indent=2))

 def seed(self,leg,start,end,weight):
  version=hashlib.sha256((self.root/'search').read_bytes()).hexdigest()[:8];name=f'unbounded-{leg}-w{weight}-{version}';file=self.root/f'{name}.json'
  if file.exists():return json.loads(file.read_text())
  output=self.root/f'{name}.bin';command=[str(self.root/'search'),str(self.root),str(self.meta['width']),str(self.meta['height']),str(start['row']),str(start['col']),str(end['row']),str(end['col']),'45',str(weight),'1000000000','4','3','-',str(output),'0']
  began=time.monotonic();process=subprocess.run(command,capture_output=True,text=True);status=json.loads(process.stdout)
  if not status.get('feasible'):raise RuntimeError(f'Unrestricted seed failed: {leg}: {status}')
  status.update(id=leg,start=start,end=end,pathfile=output.name,weight=weight,cap=45,seconds=time.monotonic()-began)
  file.write_text(json.dumps(status,ensure_ascii=False,indent=2));print('Unrestricted seed',leg,weight,status,flush=True);return status
 def seeds(self,leg,start,end):
  proposed=[]
  for key,file in self.previous.items():
   if key.split('|')[0]==leg:proposed.append(json.loads((self.root/file).read_text()))
  proposed.extend([self.seed(leg,start,end,1),self.seed(leg,start,end,.000001)])
  pool=[];seen=set()
  # Old named regions, weight variants and exclusion detours are proposals only.
  for pattern in [f'{leg}-le2-*.json',f'{leg}*-via*.json',f'{leg}*-distinct*.json']:
   for file in self.root.glob(pattern):
    s=json.loads(file.read_text())
    if s.get('feasible') and s.get('pathfile') and (self.root/s['pathfile']).exists():pool.append(s)
  if leg=='D5':
   # Return proposals are additional basin seeds for this symmetric leg.
   for pattern in ('RF*.json','RG*.json','RJV*.json','RMV*.json','published-RETURN*.json'):
    for file in self.root.glob(pattern):
     q=json.loads(file.read_text());path=self.root/q.get('pathfile','missing')
     if not q.get('feasible') or not path.is_file():continue
     p=np.fromfile(path,np.int32).reshape(-1,2)
     if not np.array_equal(p[0],[end['row'],end['col']]) or not np.array_equal(p[-1],[start['row'],start['col']]):continue
     p=p[::-1].copy();output=self.root/('reverse-seed-'+hashlib.sha256(p.tobytes()).hexdigest()[:16]+'.bin')
     if not output.exists():p.tofile(output)
     pool.append({**q,'pathfile':output.name,'start':start,'end':end})
  def points(s):return np.fromfile(self.root/s['pathfile'],np.int32).reshape(-1,2)
  # Keep short and low-cost proposals, plus genuinely different corridors.
  pool.sort(key=lambda s:s.get('validated',s).get('weighted_cost_m',float('inf')))
  for s in pool:
   p=points(s)
   if not np.array_equal(p[0],[start['row'],start['col']]) or not np.array_equal(p[-1],[end['row'],end['col']]):continue
   reference=np.hypot(start['row']-end['row'],start['col']-end['col'])
   if all(minimum.MinimumPolicy.separation(p,points(q),reference)['distinct'] for q in proposed):proposed.append(s)
   if len(proposed)>=7:break
  for s in proposed:
   p=points(s);digest=hashlib.sha256(p.tobytes()).hexdigest()
   if digest in seen:continue
   seen.add(digest);yield {**s,'id':leg,'start':start,'end':end}
 def known_minima(self,start,end):
  # A merged/rejected minimum still defines the shortest-known reference.
  # Keep every converged geometry for the current engine and terrain revision.
  for file in self.root.glob(f'minimum-*-{self.refiner.engine}.json'):
   s=json.loads(file.read_text())
   if s.get('terrain_revision')!=self.refiner.engine or not s.get('local_refinement',{}).get('converged'):continue
   if any(s.get('start',{}).get(k)!=start[k] or s.get('end',{}).get(k)!=end[k] for k in ('row','col')):continue
   if not (self.root/s['pathfile']).is_file():continue
   yield s
 def run(self,only=None):
  # Save the previous manifest before publishing any replacement.
  backup=self.root/'before-minima-manifest.json'
  if not backup.exists():backup.write_text(json.dumps(self.previous,indent=2))
  legs=[('D1',0,1),('D2',1,2),('D3',2,3),('D4',3,4),('D5',4,5),('VP',1,3),('VJ',4,6),('JM',6,7)]
  if only:
   legs=[entry for entry in legs if entry[0] in only]
   self.manifest={k:v for k,v in self.previous.items() if k.split('|')[0] not in only and not ('D5' in only and k.startswith('R|'))}
   summary=self.root/'minimum-summary.json'
   self.report=[r for r in json.loads(summary.read_text()) if r['leg'] not in only] if summary.exists() else []
  for leg,a,b in legs:
   candidates=[]
   for seed in self.seeds(leg,self.huts[a],self.huts[b]):
    status=seed if seed.get('terrain_revision')==self.refiner.engine and seed.get('minimum_selection') else self.refiner.refine(seed);status['points']=np.fromfile(self.root/status['pathfile'],np.int32).reshape(-1,2);candidates.append(status)
   seed_count=len(candidates);seed_outcomes=[dict(seed=s.get('seed',s['pathfile']),pathfile=s['pathfile'],distance_km=s['validated']['distance_km'],cost_m=s['validated']['weighted_cost_m']) for s in candidates]
   unique={}
   for s in candidates:unique.setdefault(hashlib.sha256(s['points'].tobytes()).hexdigest(),s)
   candidates=list(unique.values());seen=set(unique)
   for status in self.known_minima(self.huts[a],self.huts[b]):
    points=np.fromfile(self.root/status['pathfile'],np.int32).reshape(-1,2);digest=hashlib.sha256(points.tobytes()).hexdigest()
    if digest in seen:continue
    seen.add(digest);candidates.append({**status,'points':points})
   selected,report=minimum.MinimumPolicy.select(candidates)
   if not selected:raise RuntimeError('No eligible minimum: '+leg)
   report.update(leg=leg,seed_count=seed_count,seed_outcomes=seed_outcomes,known_minima_count=len(candidates),retained=len(selected),converged=[dict(seed=s['seed'],distance_km=s['validated']['distance_km'],cost_m=s['validated']['weighted_cost_m'],pathfile=s['pathfile']) for s in candidates]);self.report.append(report)
   for rank,status in enumerate(selected,1):
    status=dict(status);status.pop('points');status['variant_id']=f'1{chr(96+rank)}' if leg=='D1' else (leg[1:] if leg.startswith('D') and rank==1 else leg if rank==1 else leg+chr(64+rank))
    status['variant_label']='Lowest-cost minimum found' if rank==1 else f'Distinct basin · cost +{100*(status["validated"]["weighted_cost_m"]/report["best_cost_m"]-1):.0f}%'
    file=self.root/f'basin-{leg}-{rank}.json';file.write_text(json.dumps(status,ensure_ascii=False,indent=2));self.manifest[f'{leg}|{rank}']=file.name
   print('Selected basins',leg,report,flush=True)
   (self.root/'minimum-summary.json').write_text(json.dumps(self.report,ensure_ascii=False,indent=2))
  # Symmetric slope/heading cost gives the same minima in either direction.
  for key,file in list(self.manifest.items()):
   if not key.startswith('D5|'):continue
   rank=int(key.split('|')[1]);status=json.loads((self.root/file).read_text());p=np.fromfile(self.root/status['pathfile'],np.int32).reshape(-1,2)[::-1].copy();path=self.root/f'basin-R-{rank}.bin';p.tofile(path)
   status.update(id='R',start=status['end'],end=status['start'],pathfile=path.name,variant_id='R' if rank==1 else 'R'+chr(68+rank),retrace=True,shares_outward_corridor=rank==1)
   status['validated']=self.refiner.validation.validate(self.refiner.terrain,path,45,1)
   file=self.root/f'basin-R-{rank}.json';file.write_text(json.dumps(status,ensure_ascii=False,indent=2));self.manifest[f'R|{rank}']=file.name
  (self.root/'published-routes.json').write_text(json.dumps(self.manifest,indent=2));(self.root/'geographic-summary.json').write_text(json.dumps(self.report,ensure_ascii=False,indent=2))

if __name__=='__main__':MinimumDiscovery(sys.argv[1]).run(set(sys.argv[2:]) or None)
