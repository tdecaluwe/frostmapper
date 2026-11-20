from pathlib import Path
import json,math,functools
import numpy as np
root=Path(__import__('sys').argv[1]);meta=json.loads((root/'meta.json').read_text());heights=np.load(root/'height.npy',mmap_mode='r');slopes=np.load(root/'slope.npy',mmap_mode='r');spacing=np.fromfile(root/'spacing.bin',dtype=np.float64);H,W=slopes.shape
@functools.lru_cache(None)
def hits(dr,dc):
 # Independent slab clipping: intersect the track segment with raster squares.
 result=[]
 for r in range(min(0,dr)-1,max(0,dr)+2):
  for c in range(min(0,dc)-1,max(0,dc)+2):
   lo,hi=0.,1.;valid=True
   for v,p in [(dr,r),(dc,c)]:
    if v==0:
     if abs(p)>.5:valid=False
    else:
     a,b=sorted(((p-.5)/v,(p+.5)/v));lo=max(lo,a);hi=min(hi,b)
   if valid and hi>=lo-1e-10:result.append((r,c,max(0.,hi-lo)))
 return result

def analyze(pathfile):
 p=np.fromfile(root/pathfile,dtype=np.int32).reshape(-1,2);length=steep=over20=severity=0.;maxslope=0.;maxexcess=-math.inf;tests=0
 for (r,c),(rr,cc) in zip(p[:-1],p[1:]):
  dr,dc=int(rr-r),int(cc-c);norm=math.hypot(dr,dc);ux,uy=dc/norm,dr/norm
  for y,x,f in hits(dr,dc):
   if f<1e-9:continue
   y+=r;x+=c;s=float(slopes[y,x]);dl=f*spacing[y]*norm;length+=dl
   maxslope=max(maxslope,s)
   if s>15:steep+=dl;severity+=(s-15)*dl
   if s>20:over20+=dl
   if s>10:
    gx=float(heights[y,min(W-1,x+1)])-float(heights[y,max(0,x-1)]);gy=float(heights[min(H-1,y+1),x])-float(heights[max(0,y-1),x]);angle=math.degrees(math.acos(min(1.,abs(gx*ux+gy*uy)/math.hypot(gx,gy))))
    excess=angle-(30-s);maxexcess=max(maxexcess,excess);assert excess<1e-7,(pathfile,y,x,s,angle);tests+=1
 delta=np.diff(heights[p[:,0],p[:,1]])
 return dict(pathfile=pathfile,distance_km=length/1000,distance_above_15_m=steep,distance_above_20_m=over20,max_slope_deg=maxslope,slope_excess_degree_metres=severity,ascent_m=float(delta.clip(0).sum()),descent_m=float(-delta.clip(max=0).sum()),fallline_checks=tests,maximum_angle_rule_excess_deg=maxexcess)

if __name__=='__main__':
 import sys
 results=[]
 for f in sys.argv[2:]:
  r=analyze(f);results.append(r);print(json.dumps(r),flush=True)
 (root/'exposure-validated.json').write_text(json.dumps(results,indent=2))
