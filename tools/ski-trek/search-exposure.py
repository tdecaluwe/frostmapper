"""Offline candidate search; working rasters and outputs stay in argv[1]."""
from pathlib import Path
import sys,json,subprocess
import numpy as np
from scipy.ndimage import maximum_filter
root=Path(sys.argv[1]);meta=json.loads((root/'meta.json').read_text());slope=np.load(root/'slope.npy',mmap_mode='r');H,W=slope.shape
slope.tofile(root/'slope-float.bin');np.load(root/'height.npy',mmap_mode='r').tofile(root/'height.bin')
maximum_filter((slope>10).astype('uint8'),size=19).tofile(root/'near-steep.bin')
results=[]
def run(day,cap,penalty,name,bound=25000,R=8,mask=None):
 a=meta['huts'][day-1] if day!=6 else meta['huts'][5];b=meta['huts'][day] if day!=6 else meta['huts'][4]
 command=[str(root/'exposure'),str(H),str(W),str(a['row']),str(a['col']),str(b['row']),str(b['col']),str(cap),str(penalty),name,str(bound),str(R)]
 if mask:command.append(mask)
 process=subprocess.run(command,cwd=root,capture_output=True,text=True)
 if not process.stdout:raise RuntimeError(process.stderr)
 result=json.loads(process.stdout);result.update(day=day,cap=cap,penalty=penalty,pathfile=name,bound=bound,direction_radius=R);results.append(result)
 (root/'exposure-search.json').write_text(json.dumps(results,indent=2));print(result,flush=True);return result
for R in [8,16]:
 maximum_filter((slope>10).astype('uint8'),size=2*R+3).tofile(root/'near-steep.bin')
 run(1,20,1000,f'day1-under20-r{R}-25km.bin',R=R)
maximum_filter((slope>10).astype('uint8'),size=19).tofile(root/'near-steep.bin')
run(1,20,1000,'day1-under20-long.bin',bound=50000)
for cap in [22.5,25,29.9]:
 for penalty in [1000,.001,.02,.1,.5,1]:
  r=run(1,cap,penalty,f'exposure-day-1-cap-{cap}-lambda-{penalty}.bin')
  if not r['feasible']:break
for day in [2,3,4,5]:
 for penalty in [1000,.001,.03,.3]:
  r=run(day,29.9,penalty,f'exposure-day-{day}-lambda-{penalty}.bin')
  if not r['feasible'] or r.get('distance_above_15_m')==0 and r.get('distance_m',1e9)<=18000:break
# Local exclusion gates seek genuine lower-valley diversions while allowing
# shared approaches and upper terrain. They are explicit variety constraints.
spacing=np.fromfile(root/'spacing.bin',dtype=np.float64);path=np.fromfile(root/'exposure-day-5-lambda-0.001.bin',dtype=np.int32).reshape(-1,2);delta=np.diff(path,axis=0)
chainage=np.r_[0,np.cumsum(np.hypot(delta[:,0],delta[:,1])*(spacing[path[:-1,0]]+spacing[path[1:,0]])/2)]
rows=np.arange(H)[:,None];cols=np.arange(W)[None,:]
for fraction in [.1,.15,.25,.35,.5,.75]:
 r,c=path[np.searchsorted(chainage,chainage[-1]*fraction)];mask=f'exposure-gate-{fraction}.bin';(np.hypot(rows-r,cols-c)*spacing[:,None]<500).astype('uint8').tofile(root/mask)
 run(6,29.9,.01,f'exposure-return-gate-{fraction}-lambda-0.01.bin',bound=35000,mask=mask)
