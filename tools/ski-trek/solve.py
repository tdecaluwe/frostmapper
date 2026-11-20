from pathlib import Path
import numpy as np,json,subprocess,time,math
from scipy import ndimage
root=Path(__import__('sys').argv[1]);meta=json.loads((root/'meta.json').read_text());slope=np.load(root/'slope.npy',mmap_mode='r');heights=np.load(root/'height.npy',mmap_mode='r');H,W=slope.shape
q=np.fromfile(root/'slope.bin',dtype=np.uint16).reshape(H,W);labels=np.empty((H,W),np.int32);results=[];total=time.time()
for day,(a,b) in enumerate(zip(meta['huts'][:-1],meta['huts'][1:]),1):
 t=time.time();sa=(a['row'],a['col']);sb=(b['row'],b['col']);low=max(int(q[sa]),int(q[sb]),100)-1;high=899
 while high-low>1:
  mid=(low+high)//2;ndimage.label(q<=mid,output=labels)
  if labels[sa] and labels[sa]==labels[sb]:high=mid
  else:low=mid
 minimum=high;cache={}
 def evaluate(threshold):
  if threshold in cache:return cache[threshold]
  f=f'leg-{day}-threshold-{threshold}.bin'
  r=subprocess.run([str(root/'shortest'),str(H),str(W),str(sa[0]),str(sa[1]),str(sb[0]),str(sb[1]),str(threshold),f,'25000'],cwd=root,capture_output=True,text=True)
  info=json.loads(r.stdout) if not r.returncode else {'distance_m':float('inf')}
  cache[threshold]=(info,f)
  print('day',day,'threshold',threshold/10,'distance',info['distance_m'],'seconds',round(time.time()-t,1),flush=True)
  return cache[threshold]
 output={'day':day,'start':a['name'],'end':b['name'],'unconstrained_threshold':minimum/10,'options':{}}
 for bound in [25000,18000]:
  if evaluate(minimum)[0]['distance_m']<=bound:best=minimum
  else:
   low=minimum;high=899
   if evaluate(high)[0]['distance_m']>bound:
    output['options'][str(bound)]={'feasible':False};continue
   while high-low>1:
    mid=(low+high)//2
    if evaluate(mid)[0]['distance_m']<=bound:high=mid
    else:low=mid
   best=high
  info,f=evaluate(best);path=np.fromfile(root/f,dtype=np.int32).reshape(-1,2);rr,cc=path[:,0],path[:,1];samples=slope[rr,cc];alt=heights[rr,cc];delta=np.diff(alt);margin=int(min(rr.min(),cc.min(),H-1-rr.max(),W-1-cc.max()))
  info={**info,'feasible':True,'threshold_deg':best/10,'max_sample_deg':float(samples.max()),'pathfile':f,'ascent_m':float(delta.clip(0).sum()),'descent_m':float(-delta.clip(max=0).sum()),'edge_margin_pixels':margin,'bottleneck_pixel':path[int(samples.argmax())].tolist()}
  output['options'][str(bound)]=info
 results.append(output);(root/'constrained-results.json').write_text(json.dumps(results,indent=2,ensure_ascii=False));print('RESULT',json.dumps(output,ensure_ascii=False),'elapsed',round(time.time()-total,1),flush=True)
