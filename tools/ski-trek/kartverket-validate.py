"""Independent integration against cached native float elevations, not search costs.
Reads one exported path, checks each intersected native cell and returns metrics.
"""
import functools,json,math,sys,zlib
from pathlib import Path
import numpy as np

class Terrain:
 def __init__(self,root):
  self.root=Path(root);self.meta=json.loads((self.root/'meta.json').read_text())
 @functools.lru_cache(maxsize=24)
 def tile(self,tx,ty):
  return np.frombuffer(zlib.decompress((self.root/'terrain'/f'{tx}-{ty}.f32z').read_bytes()),dtype=np.float32).reshape(1000,1000)
 def height(self,row,col):
  x=self.meta['xmin']+col;y=self.meta['ymax']-1-row;tx,px=divmod(x,1000);ty,py=divmod(y,1000)
  return float(self.tile(tx,ty)[999-py,px])
 @functools.lru_cache(maxsize=150000)
 def field(self,row,col):
  gx=(self.height(row,col+1)-self.height(row,col-1))*.5;gy=(self.height(row+1,col)-self.height(row-1,col))*.5
  return math.degrees(math.atan(math.hypot(gx,gy))),gx,gy

 @functools.lru_cache(maxsize=150000)
 def heading(self,row,col):
  gx=(self.height(row,col+5)-self.height(row,col-5))/10;gy=(self.height(row+5,col)-self.height(row-5,col))/10
  return math.degrees(math.atan(math.hypot(gx,gy))),gx,gy

@functools.lru_cache(None)
def intersections(dr,dc):
 out=[]
 for row in range(min(0,dr)-1,max(0,dr)+2):
  for col in range(min(0,dc)-1,max(0,dc)+2):
   a,b=0.,1.;valid=True
   for v,p in ((dr,row),(dc,col)):
    if not v:
     if abs(p)>.5:valid=False
    else:
     lo,hi=sorted(((p-.5)/v,(p+.5)/v));a=max(a,lo);b=min(b,hi)
   if valid and b>=a-1e-10:out.append((row,col,max(0.,b-a)))
 return out

def validate(terrain,path,cap,penalty_multiplier):
 points=np.fromfile(path,dtype=np.int32).reshape(-1,2);distance=cost=above10=above15=above20=peak=ascent=descent=0.;worst=-math.inf;checks=0;heading_peak=0.
 for (row,col),(rr,cc) in zip(points,points[1:]):
  row,col,rr,cc=map(int,(row,col,rr,cc));dr,dc=rr-row,cc-col;norm=math.hypot(dr,dc)
  for dy,dx,fraction in intersections(dr,dc):
   s,gx,gy=terrain.field(row+dy,col+dx)
   assert math.isfinite(s) and s<=cap+1e-5,('cap',s,cap,row+dy,col+dx)
   if fraction<=1e-9:continue
   dl=fraction*norm;distance+=dl;peak=max(peak,s);checks+=1
   grade=math.tan(math.radians(s))
   cost+=dl*(1+penalty_multiplier*(10*grade+6**(5*grade-1)-1/6))
   above10+=dl*(s>10);above15+=dl*(s>15);above20+=dl*(s>20)
   heading,gx,gy=terrain.heading(row+dy,col+dx);heading_peak=max(heading_peak,heading)
   if heading>10:
    angle=math.degrees(math.acos(min(1,abs(gx*dc+gy*dr)/(math.hypot(gx,gy)*norm))))
    excess=angle-(90-3*heading);worst=max(worst,excess)
    assert excess<=1e-5,('fall line',s,angle,row+dy,col+dx)
  delta=terrain.height(rr,cc)-terrain.height(row,col);ascent+=max(delta,0);descent+=max(-delta,0)
 return dict(distance_km=distance/1000,weighted_cost_m=cost,distance_above_10_m=above10,distance_above_15_m=above15,distance_above_20_m=above20,max_slope_deg=peak,max_heading_slope_deg=heading_peak,ascent_m=ascent,descent_m=descent,native_cell_checks=checks,maximum_angle_rule_excess_deg=worst)

if __name__=='__main__':
 root=Path(sys.argv[1]);terrain=Terrain(root)
 for file in sys.argv[2:]:
  status=json.loads(Path(file).read_text())
  if not status['feasible']:continue
  result=validate(terrain,root/status['pathfile'],status['cap'],status['weight']);status['validated']=result;Path(file).write_text(json.dumps(status,indent=2,ensure_ascii=False));print(Path(file).name,json.dumps(result),flush=True)
