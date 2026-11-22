"""Analytic routing checks. Run with NumPy and a compiled exposure solver."""
from pathlib import Path
import tempfile,subprocess,json,sys
import numpy as np
solver=str(Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory() as temp:
 root=Path(temp);H=W=18;np.ones(H,dtype='float64').tofile(root/'spacing.bin');np.ones((H,W),dtype='uint8').tofile(root/'near-steep.bin')
 def prepare(grade):
  heights=np.tile(np.arange(W)*np.tan(np.deg2rad(grade)),(H,1)).astype('float32');heights.tofile(root/'height.bin')
  slopes=np.full((H,W),grade,dtype='float32');slopes.tofile(root/'slope-float.bin');return slopes
 def run(start,end,bound=30,penalty=.001,cap=29.9):
  result=subprocess.run([solver,str(H),str(W),str(start[0]),str(start[1]),str(end[0]),str(end[1]),str(cap),str(penalty),'path.bin',str(bound),'8'],cwd=root,capture_output=True,text=True)
  return json.loads(result.stdout)
 prepare(20);r=run((8,2),(8,12));assert r['feasible'] and abs(r['distance_m']-10)<1e-5 and abs(r['distance_above_15_m']-10)<1e-5 and r['maximum_fallline_deviation_deg']<1e-5
 r=run((5,8),(9,8),bound=6);assert not r['feasible'] or r['distance_m']>6
 assert not run((8,2),(8,12),cap=19.9)['feasible']
 prepare(20);r=run((5,2),(7,6),bound=5);assert r['feasible'] and abs(r['distance_m']-np.sqrt(20))<1e-4
 prepare(25);r=run((5,2),(6,6),bound=4.2);assert r['feasible']
 r=run((5,2),(6,5),bound=3.5);assert not r['feasible'] or r['distance_m']>3.5
 prepare(5);r=run((5,8),(9,8));assert r['feasible'] and r['distance_above_15_m']==0 and abs(r['distance_m']-4)<1e-5
 slopes=prepare(13);slopes[8,8]=16;slopes.tofile(root/'slope-float.bin');r=run((8,2),(8,14));assert r['feasible'] and r['distance_above_15_m']==0 and r['distance_m']>12
 print('Analytic planes: along-fall-line travel, transverse rejection, terrain cap, free gentle terrain and steep-cell avoidance passed')
