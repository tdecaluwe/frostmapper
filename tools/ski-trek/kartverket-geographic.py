"""Refine basin candidates under one cost; retain geographically distinct routes."""
from pathlib import Path
import hashlib,importlib.util,json,subprocess,sys,time
import numpy as np
from scipy.spatial import cKDTree

class GeographicDiversity:
 separation=500
 minimum_run=1000
 @classmethod
 def measure(cls,a,b):
  distances,index=cKDTree(a).query(b);steps=np.hypot(*np.diff(b,axis=0).T)
  different=(distances[:-1]>cls.separation)&(distances[1:]>cls.separation)
  run=longest=0.
  for length,away in zip(steps,different):
   run=run+length if away else 0.;longest=max(longest,run)
  away=distances>cls.separation;direction='Alternative'
  if away.any():
   delta=np.mean(b[away]-a[index[away]],axis=0);north=-delta[0];east=delta[1]
   direction=('Eastern' if east>0 else 'Western') if abs(east)>abs(north) else ('Northern' if north>0 else 'Southern')
  return dict(maximum_sampled_separation_m=float(distances.max()),longest_separated_run_m=longest,separation_threshold_m=cls.separation,minimum_separated_run_m=cls.minimum_run,direction=direction)
 @classmethod
 def distinct(cls,a,b):return max(cls.measure(a,b)['longest_separated_run_m'],cls.measure(b,a)['longest_separated_run_m'])>=cls.minimum_run

class CandidateRefiner:
 def __init__(self,root):
  self.root=Path(root);self.revision=hashlib.sha256('|'.join(sorted(p.stem for p in (self.root/'terrain').glob('*.done'))).encode()).hexdigest()[:8];self.meta=json.loads((self.root/'meta.json').read_text())
  spec=importlib.util.spec_from_file_location('native_validation',Path(__file__).with_name('kartverket-validate.py'));self.validation=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.validation);self.terrain=self.validation.Terrain(root)
 def points(self,status):return np.fromfile(self.root/status['pathfile'],np.int32).reshape(-1,2)
 def score(self,status,cap):
  return self.validation.validate(self.terrain,self.root/status['pathfile'],cap,1)
 def refine(self,status,cap,bound):
  digest=hashlib.sha256((self.root/status['pathfile']).read_bytes()).hexdigest()[:12]
  name=f"{status['id']}-local2s-{digest}-f{self.revision}-cap{cap}";file=self.root/f'{name}.json'
  if file.exists():return json.loads(file.read_text())
  start=time.monotonic();output=self.root/f'{name}.bin';current=self.root/status['pathfile'];reports=[]
  def stage(mode,label):
   nonlocal current
   target=self.root/f'{name}-{label}.bin';report=self.root/f'{name}-{label}.json'
   command=[str(self.root/'local'),str(self.root),str(self.meta['width']),str(self.meta['height']),str(cap),str(bound),str(current),str(target),str(report)]
   if mode=='micro':command.append('micro')
   subprocess.run(command,check=True,capture_output=True,text=True);result=json.loads(report.read_text());reports.append(result);current=target
   if not result['converged'] or result['unresolved_windows']:raise RuntimeError(f'Local neighborhood check unresolved: {status["id"]}: {result}')
   return result
  macro=stage('macro','macro0')
  for cycle in range(4):
   micro=stage('micro',f'micro{cycle}');macro=stage('macro',f'macro{cycle+1}')
   if macro['improvements']==0:break
  else:raise RuntimeError('Two-scale refinement failed to stabilize')
  import shutil
  shutil.copy2(current,output)
  local=dict(converged=True,unresolved_windows=0,macro=macro,micro=micro,cycles=cycle+1,tested_windows=sum(r['tested_windows'] for r in reports),improvements=sum(r['improvements'] for r in reports))
  metrics=self.validation.validate(self.terrain,output,cap,1)
  assert metrics['distance_km']*1000<=bound+.01
  result={**status,'feasible':True,'weight':1,'cap':cap,'bound':bound,'pathfile':output.name,'validated':metrics,'local_refinement':local,'local_refinement_seconds':time.monotonic()-start,'selected_from':status['pathfile'],'terrain_revision':self.revision}
  file.write_text(json.dumps(result,ensure_ascii=False,indent=2));print('Refined',status['id'],round(metrics['distance_km'],3),round(metrics['weighted_cost_m']),local,flush=True);return result

class GeographicPlanner:
 def __init__(self,root):self.refiner=CandidateRefiner(root);self.root=Path(root);self.manifest={};self.summary=[]
 def pool(self,id,cap,bound):
  pool=[];seen=set()
  for pattern in [f'{id}-le2-p250-h10-*.json',f'{id}-le1-p250-h10-*.json',f'{id}-p250-h10-*.json']:
   for file in self.root.glob(pattern):
    status=json.loads(file.read_text())
    if not status.get('feasible'):continue
    points=self.refiner.points(status)
    if list(points[0])!=[status['start']['row'],status['start']['col']] or list(points[-1])!=[status['end']['row'],status['end']['col']]:continue
    digest=hashlib.sha256(points.tobytes()).hexdigest()
    if digest in seen:continue
    seen.add(digest)
    try:metrics=self.refiner.score(status,cap)
    except AssertionError:continue
    if metrics['distance_km']*1000>bound+.01:continue
    pool.append({**status,'validated':metrics})
  return pool
 def choose(self,id,pool,cap,bound,slots,maximum=2,reference=None,allow_empty=False):
  seeds=[]
  for status in sorted(pool,key=lambda s:s['validated']['weighted_cost_m']):
   points=self.refiner.points(status)
   if reference is not None and not GeographicDiversity.distinct(self.refiner.points(reference),points):continue
   if all(GeographicDiversity.distinct(self.refiner.points(existing),points) for existing in seeds):seeds.append(status)
   if len(seeds)>=maximum+1:break
  refined=[s for seed in seeds if (s:=self.refiner.refine(seed,cap,bound))]
  selected=[]
  for status in sorted(refined,key=lambda s:s['validated']['weighted_cost_m']):
   points=self.refiner.points(status)
   if reference is not None and not GeographicDiversity.distinct(self.refiner.points(reference),points):continue
   if selected and not all(GeographicDiversity.distinct(self.refiner.points(other),points) for other in selected):continue
   if selected:
    status['geographic_diversity']=GeographicDiversity.measure(self.refiner.points(selected[0]),points);status['variant_label']=status['geographic_diversity']['direction']+' alternative corridor'
   else:status['variant_label']='Lowest cost found in this corridor'
   file=self.root/f'published-{id}-{len(selected)}.json';file.write_text(json.dumps(status,ensure_ascii=False,indent=2));self.manifest[slots[len(selected)]]=file.name;selected.append(status)
   if len(selected)>=maximum:break
  if not selected and not allow_empty:raise RuntimeError(f'No locally checked candidate retained for {id}')
  self.summary.append(dict(leg=id,retained=len(selected),geographic_seed_count=len(seeds)));return selected
 def run(self):
  for id in ['D1','D2','D3','D4','D5','VP','VJ','JM']:
   cap=45
   selected=self.choose(id,self.pool(id,cap,25000),cap,25000,[f'{id}|1',f'{id}|2'])
   if id=='D5':fifth=selected[0]
  # The retrace is exactly the selected outward route, with symmetric cost.
  p=self.refiner.points(fifth)[::-1].copy();file=self.root/'R-selected-retrace.bin';p.tofile(file)
  reverse={**fifth,'id':'R','pathfile':file.name,'start':fifth['end'],'end':fifth['start']};reverse['validated']=self.refiner.score(reverse,45)
  reverse=self.refiner.refine(reverse,45,35000)
  if reverse is None:raise RuntimeError('Return in outward corridor failed local check')
  reverse['retrace']=bool(np.array_equal(self.refiner.points(reverse),p))
  reverse['shares_outward_corridor']=not GeographicDiversity.distinct(self.refiner.points(fifth),self.refiner.points(reverse))
  reverse['variant_label']='Exact retrace of day 5' if reverse['retrace'] else 'Return in the outward corridor'
  pool=[]
  for id in ['RFA','RGA','RFB','RGB','RJV','RMV','RJVN','RMVN']:pool+=self.pool(id,45,35000)
  self.choose('RETURN',pool,45,35000,['RF|1','RG|2'],maximum=2,reference=reverse,allow_empty=True)
  file=self.root/'published-R.json';file.write_text(json.dumps(reverse,ensure_ascii=False,indent=2));self.manifest['R|1']=file.name
  (self.root/'published-routes.json').write_text(json.dumps(self.manifest,indent=2));(self.root/'geographic-summary.json').write_text(json.dumps(self.summary,indent=2))

if __name__=='__main__':GeographicPlanner(sys.argv[1]).run()
