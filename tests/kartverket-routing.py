"""Native-cell routing regressions; uses tiny synthetic rasters, no network."""
from pathlib import Path
import json,subprocess,tempfile
import numpy as np
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as name:
 work=Path(name);binary=work/'search'
 subprocess.run(['g++','-O2','-std=c++17',str(root/'tools/ski-trek/kartverket-search.cpp'),'-o',str(binary)],check=True)
 slope=np.ones((81,121),np.uint16);aspect=np.zeros_like(slope,dtype=np.int16)
 def run(weight=1,cap=29.5,heading=None,mesh=1):
  slope.tofile(work/'slope.u16');(slope if heading is None else heading).tofile(work/'heading-slope.u16');aspect.tofile(work/'aspect.i16')
  p=subprocess.run([str(binary),str(work),'121','81','40','10','40','110',str(cap),str(weight),'250',str(mesh),'3','-',str(work/'path.bin')],capture_output=True,text=True)
  assert p.stdout,p.stderr
  return json.loads(p.stdout), np.fromfile(work/'path.bin',np.int32).reshape(-1,2) if p.returncode==0 else None
 # A narrow 15-degree patch on the direct route. Stronger local cost must take
 # a longer gentle detour; a negligible penalty keeps the short crossing.
 slope[30:51,59:62]=1501
 direct,p=run(.00001);detour,q=run(1)
 assert direct['feasible'] and detour['feasible']
 assert direct['distance_above_15_m']==0 # exactly 15, not >15
 assert direct['max_slope_deg']==15
 assert detour['max_slope_deg']==0
 assert detour['distance_m']>direct['distance_m']
 # Unknown cells and a one-metre cliff wall both close a crossing. Long graph
 # edges must never jump over a thin obstruction or an unavailable tile.
 slope[:]=1;slope[:,60]=0
 assert not run()[0]['feasible']
 assert not run(mesh=4)[0]['feasible']
 slope[:,60]=8101
 assert not run()[0]['feasible']
 # Heading restrictions apply inside edges, not just at graph vertices.
 slope[:]=1;slope[:,59:62]=2901;aspect[:,59:62]=9000
 assert not run()[0]['feasible']
 # Native roughness may be steep while the 10 m fall-line field is gentle.
 assert run(heading=np.ones_like(slope))[0]['feasible']
 slope[:]=1671;aspect[:]=0
 doubled,_=run(1)
 import math
 grade=math.tan(math.radians(16.7))
 expected=1+10*grade+6**(5*grade-1)-1/6
 assert abs(doubled['weighted_cost_m']/doubled['distance_m']-expected)<.001
print('Linear/exponential local tradeoff, 1 m cliff, unknown-data barrier and fall-line checks passed')
