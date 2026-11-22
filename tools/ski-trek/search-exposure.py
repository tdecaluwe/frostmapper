"""Offline exposure routing with angle <= 90 - 3*slope above 10 degrees."""
from pathlib import Path
import sys,json,math,subprocess
import numpy as np
from scipy.ndimage import maximum_filter
root=Path(sys.argv[1]);meta=json.loads((root/'meta.json').read_text());slope=np.load(root/'slope.npy',mmap_mode='r');H,W=slope.shape
slope.tofile(root/'slope-float.bin');np.load(root/'height.npy',mmap_mode='r').tofile(root/'height.bin')
maximum_filter((slope>10).astype('uint8'),size=19).tofile(root/'near-steep.bin')
results=[]
def run(day,cap,penalty,name,bound=25000,goal=None,endpoints=None,mask=None):
 a,b=endpoints if endpoints else ((meta['huts'][5],meta['huts'][4]) if day==6 else (meta['huts'][day-1],meta['huts'][day]))
 if goal is not None:b=meta['huts'][goal]
 command=[str(root/'exposure'),str(H),str(W),str(a['row']),str(a['col']),str(b['row']),str(b['col']),str(cap),str(penalty),name,str(bound),'8']
 if mask:command.append(mask)
 process=subprocess.run(command,cwd=root,capture_output=True,text=True)
 if not process.stdout:raise RuntimeError(process.stderr)
 result=json.loads(process.stdout);result.update(day=day,cap=cap,penalty=penalty,pathfile=name,bound=bound,goal=goal)
 results.append(result);(root/'exposure-search.json').write_text(json.dumps(results,indent=2));print(result,flush=True);return result
# Different first-night destination: never silently splice it into the main plan.
run(1,20,1000,'torsbu-under20-25km.bin',goal=2)
run(1,20,1000,'torsbu-under20-long.bin',bound=50000,goal=2)
run(1,20,.01,'torsbu-under20-exposure-long.bin',bound=50000,goal=2)
for cap in [20,22.5,23.5,25,29.9]:
 for penalty in [1000,.001,.02,.03,.1,.5,1]:
  r=run(1,cap,penalty,f'day1-cap-{cap}-lambda-{penalty}.bin')
  if not r['feasible']:break
for day in [2,3,4,5]:
 for penalty in [1000,.001,.03,.3]:
  r=run(day,29.9,penalty,f'day{day}-lambda-{penalty}.bin')
  if not r['feasible'] or r.get('distance_above_15_m')==0 and r.get('distance_m',1e9)<=18000:break
spacing=np.fromfile(root/'spacing.bin',dtype=np.float64);path=np.fromfile(root/'day5-lambda-0.001.bin',dtype=np.int32).reshape(-1,2);delta=np.diff(path,axis=0)
chainage=np.r_[0,np.cumsum(np.hypot(delta[:,0],delta[:,1])*(spacing[path[:-1,0]]+spacing[path[1:,0]])/2)]
rows=np.arange(H)[:,None];cols=np.arange(W)[None,:]
for fraction in [.1,.25,.5]:
 r,c=path[np.searchsorted(chainage,chainage[-1]*fraction)];mask=f'exposure-gate-{fraction}.bin';(np.hypot(rows-r,cols-c)*spacing[:,None]<500).astype('uint8').tofile(root/mask)
 for penalty in [.01,.1,.3]:run(6,29.9,penalty,f'exposure-return-gate-{fraction}-lambda-{penalty}.bin',bound=35000,mask=mask)
def point(name,lon,lat):
 world=256*2**meta['z'];c=round((lon+180)/360*world-meta['xmin']*256-.5);r=round((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*world-meta['ymin']*256-.5)
 return dict(name=name,lon=lon,lat=lat,row=r,col=c)
j=point('Jervebua',7.81791,62.30769);b=point('Mebua',7.87017486127508,62.3238102307715)
legs=[('VP',meta['huts'][1],meta['huts'][3]),('VJ',meta['huts'][4],j),('JM',j,b)];(root/'extra-legs.json').write_text(json.dumps(legs,indent=2,ensure_ascii=False))
for id,a,b in legs:
 for penalty in [1000,.01,.1]:
  r=run(0,29.9,penalty,f'extra-{id}-lambda-{penalty}.bin',endpoints=(a,b))
  if not r['feasible'] or r.get('distance_above_15_m')==0 and r.get('distance_m',1e9)<=18000:break
for penalty in [1,.1]:run(0,20,penalty,f'extra-JM-cap20-lambda-{penalty}.bin',endpoints=(j,b))
