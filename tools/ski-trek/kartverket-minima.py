"""Unpinned whole-route descent and explicit, leg-relative alternative policy."""
from pathlib import Path
import hashlib,importlib.util,json,subprocess,sys,time
import numpy as np
from scipy.spatial import cKDTree

class MinimumPolicy:
 """Eligibility follows convergence; it never changes the route objective."""
 maximum_length_ratio=2.
 maximum_cost_ratio=1.35
 separated_fraction=.15
 @staticmethod
 def samples(points,spacing=25):
  ds=np.r_[0,np.cumsum(np.hypot(*np.diff(points,axis=0).T))]
  at=np.r_[np.arange(0,ds[-1],spacing),ds[-1]]
  return np.column_stack([np.interp(at,ds,points[:,i]) for i in range(2)]),at
 @classmethod
 def separation(cls,a,b,reference_length):
  threshold=max(150.,min(500.,reference_length*.025))
  required=max(750.,reference_length*.12)
  def direction(x,y):
   xs,chain=cls.samples(x);ys,_=cls.samples(y);distance=cKDTree(ys).query(xs)[0]
   away=(distance[:-1]>threshold)&(distance[1:]>threshold)
   run=longest=total=0.
   for length,different in zip(np.diff(chain),away):
    run=run+length if different else 0.;longest=max(longest,run)
    if different:total+=length
   return dict(longest_run_m=float(longest),separated_length_m=float(total),fraction=float(total/chain[-1]))
  ab,ba=direction(a,b),direction(b,a)
  return dict(distinct=all(q['longest_run_m']>=required and q['fraction']>=cls.separated_fraction for q in [ab,ba]),separation_m=threshold,required_run_m=required,required_fraction=cls.separated_fraction,a=ab,b=ba)
 @classmethod
 def select(cls,candidates):
  if not candidates:return [],{}
  shortest=min(c['validated']['distance_km']*1000 for c in candidates)
  eligible=[c for c in candidates if c['validated']['distance_km']*1000<=cls.maximum_length_ratio*shortest+1e-5]
  best=min(c['validated']['weighted_cost_m'] for c in eligible)
  report=dict(shortest_minimum_m=shortest,maximum_distance_m=cls.maximum_length_ratio*shortest,best_cost_m=best,maximum_cost_m=cls.maximum_cost_ratio*best,rejected=[])
  selected=[]
  for c in sorted(eligible,key=lambda c:c['validated']['weighted_cost_m']):
   if c['validated']['weighted_cost_m']>report['maximum_cost_m']:
    report['rejected'].append(dict(seed=c.get('seed'),reason='cost',cost_m=c['validated']['weighted_cost_m']));continue
   comparisons=[cls.separation(c['points'],p['points'],shortest) for p in selected]
   if comparisons and not all(q['distinct'] for q in comparisons):
    report['rejected'].append(dict(seed=c.get('seed'),reason='same geographic basin',comparisons=comparisons));continue
   c={**c,'minimum_selection':{k:v for k,v in report.items() if k!='rejected'},'geographic_diversity':comparisons}
   selected.append(c)
  for c in candidates:
   if id(c) not in {id(e) for e in eligible}:report['rejected'].append(dict(seed=c.get('seed'),reason='length',distance_m=c['validated']['distance_km']*1000))
  return selected,report

class BasinRefiner:
 def __init__(self,root):
  self.root=Path(root);self.meta=json.loads((self.root/'meta.json').read_text())
  spec=importlib.util.spec_from_file_location('native_validation',Path(__file__).with_name('kartverket-validate.py'));self.validation=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.validation);self.terrain=self.validation.Terrain(self.root)
  # Executable and terrain identity invalidate every numerical-descent cache.
  self.engine=hashlib.sha256((self.root/'basin').read_bytes()+Path(__file__).read_bytes()+json.dumps(self.meta,sort_keys=True).encode()+('|'.join(sorted(p.stem for p in (self.root/'terrain').glob('*.done')))).encode()).hexdigest()[:12]
 def refine(self,status):
  digest=hashlib.sha256((self.root/status['pathfile']).read_bytes()).hexdigest()[:12]
  prefix=f"minimum-{digest}-{self.engine}";cache=self.root/f'{prefix}.json'
  if cache.exists():return json.loads(cache.read_text())
  began=time.monotonic();current=status['pathfile'];reports=[]
  # Recenter after every decrease. A final wider/finer search must independently
  # fail to improve; an iteration limit is a failure, never a convergence claim.
  for iteration in range(24):
   wide=iteration>0 and not reports[-1]['improved']
   radius,fine=(1200,60) if wide else (600,20)
   output=f'{prefix}-{iteration}.bin';report=self.root/f'{prefix}-{iteration}.json'
   subprocess.run([str(self.root/'basin'),str(self.root),str(self.meta['width']),str(self.meta['height']),'45',str(self.root/current),str(self.root/output),str(radius),str(fine),str(report)],check=True)
   result=json.loads(report.read_text());reports.append(result);current=output
   print('Descent',status.get('id'),iteration,result,flush=True)
   if wide and not result['improved']:break
  else:raise RuntimeError(f"Descent did not converge: {status.get('id')}")
  metrics=self.validation.validate(self.terrain,self.root/current,45,1)
  result={**status,'pathfile':current,'weight':1,'cap':45,'bound':None,'validated':metrics,'seed':status['pathfile'],'corridor_constraints':[],'constraint_checks':[],'local_refinement':dict(converged=True,method='whole-route moving sparse corridor; no pinned intermediate vertices or length pressure',relative_cost_tolerance=.0002,absolute_cost_tolerance_m=.25,passes=reports),'local_refinement_seconds':time.monotonic()-began,'terrain_revision':self.engine}
  result.pop('variant_id',None);result.pop('variant_label',None);cache.write_text(json.dumps(result,ensure_ascii=False,indent=2));return result

if __name__=='__main__':
 root=Path(sys.argv[1]);refiner=BasinRefiner(root)
 for name in sys.argv[2:]:refiner.refine(json.loads((root/name).read_text()))
