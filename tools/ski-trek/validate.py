from pathlib import Path
import numpy as np,json,subprocess,math
from scipy import ndimage
root=Path(__import__('sys').argv[1]);m=json.loads((root/'meta.json').read_text());results=json.loads((root/'constrained-results.json').read_text());sl=np.load(root/'slope.npy',mmap_mode='r');heights=np.load(root/'height.npy',mmap_mode='r');q=np.fromfile(root/'slope.bin',dtype=np.uint16).reshape(sl.shape);spacing=np.fromfile(root/'spacing.bin',dtype=np.float64);H,W=q.shape
for r in results:
 p=r['options']['18000'];a=m['huts'][r['day']-1];b=m['huts'][r['day']];points=np.fromfile(root/p['pathfile'],dtype=np.int32).reshape(-1,2)
 assert tuple(points[0])==(a['row'],a['col']);assert tuple(points[-1])==(b['row'],b['col'])
 rr,cc=points[:,0],points[:,1];d=np.diff(points,axis=0);assert (np.abs(d)<=1).all();assert (np.abs(d).sum(axis=1)>0).all()
 limit=round(p['threshold_deg']*10);assert (q[rr,cc]<=limit).all()
 for (y,x),(yy,xx) in zip(points[:-1],points[1:]):
  if y!=yy and x!=xx:assert q[y,xx]<=limit and q[yy,x]<=limit
 lengths=np.hypot(d[:,0],d[:,1])*(spacing[rr[:-1]]+spacing[rr[1:]])/2;length=lengths.sum();assert abs(length-p['distance_m'])<.1;assert length<=18000
 dz=np.diff(heights[rr,cc]);actual3d=np.hypot(lengths,dz).sum()
 below=limit-1;labels,_=ndimage.label(q<=below)
 if labels[a['row'],a['col']]!=0 and labels[a['row'],a['col']]==labels[b['row'],b['col']]:
  test=subprocess.run([str(root/'shortest'),str(H),str(W),str(a['row']),str(a['col']),str(b['row']),str(b['col']),str(below),'/tmp/lower-slope.bin','25000'],cwd=root,capture_output=True);assert test.returncode==2
 print(f"Day {r['day']}: length {length/1000:.3f} km; 3D {actual3d/1000:.3f} km; slope and diagonal gates valid; no path <=25 km at {below/10:.1f} degrees",flush=True)
