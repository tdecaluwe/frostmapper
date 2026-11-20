from pathlib import Path
import json,time,subprocess
import numpy as np
from scipy import ndimage
root=Path(__import__('sys').argv[1]);m=json.loads((root/'meta.json').read_text());slope=np.load(root/'slope.npy',mmap_mode='r');H,W=slope.shape;original=np.fromfile(root/'slope.bin',dtype=np.uint16).reshape(H,W);spacing=np.fromfile(root/'spacing.bin',dtype=np.float64);heights=np.load(root/'height.npy',mmap_mode='r')
pathfile=json.loads((root/'constrained-results.json').read_text())[-1]['options']['18000']['pathfile'];path=np.fromfile(root/pathfile,dtype=np.int32).reshape(-1,2);mask=np.zeros((H,W),bool);mask[path[:,0],path[:,1]]=True
print('Building corridor distance field',flush=True);distance=ndimage.distance_transform_edt(~mask)*spacing[:,None]
a=m['huts'][5];b=m['huts'][4];sa=(a['row'],a['col']);sb=(b['row'],b['col']);rr=np.arange(H)[:,None];cc=np.arange(W)[None,:]
approach=(np.hypot(rr-sa[0],cc-sa[1])*spacing[:,None]<1500)|(np.hypot(rr-sb[0],cc-sb[1])*spacing[:,None]<1500)
results=[]
for separation in [500,1000]:
 t=time.time();q=original.copy();q[(distance<separation)&~approach]=65535;filename=f'alternative-mask-{separation}.bin';q.tofile(root/filename)
 cache={}
 def evaluate(threshold):
  if threshold in cache:return cache[threshold]
  pathfile=f'return-{separation}-{threshold}.bin'
  r=subprocess.run([str(root/'shortest'),str(H),str(W),str(sa[0]),str(sa[1]),str(sb[0]),str(sb[1]),str(threshold),pathfile,'25000',filename],cwd=root,capture_output=True,text=True)
  info=json.loads(r.stdout) if not r.returncode else {'distance_m':float('inf')}
  cache[threshold]=(info,pathfile);print('separation',separation,'slope',threshold/10,'km',info['distance_m']/1000,'sec',round(time.time()-t,1),flush=True);return cache[threshold]
 info={'minimum_separation_m':separation,'shared_approaches_radius_m':1500,'options':{}}
 for bound in [25000,18000]:
  lo=154;hi=899
  if evaluate(hi)[0]['distance_m']>bound:info['options'][str(bound)]={'feasible':False};continue
  while hi-lo>1:
   mid=(lo+hi)//2
   if evaluate(mid)[0]['distance_m']<=bound:hi=mid
   else:lo=mid
  data,p=evaluate(hi);points=np.fromfile(root/p,dtype=np.int32).reshape(-1,2);r,c=points[:,0],points[:,1];dz=np.diff(heights[r,c]);alt=slope[r,c]
  info['options'][str(bound)]={**data,'feasible':True,'pathfile':p,'threshold_deg':hi/10,'max_sample_deg':float(alt.max()),'ascent_m':float(dz.clip(0).sum()),'descent_m':float(-dz.clip(max=0).sum()),'mean_distance_from_outbound_m':float(distance[r,c].mean()),'max_distance_from_outbound_m':float(distance[r,c].max())}
 results.append(info);(root/'alternative-results.json').write_text(json.dumps(results,indent=2));print('RESULT',json.dumps(info),flush=True)
