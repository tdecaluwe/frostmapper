"""Regressions for unpinned descent, length policy and useful alternatives."""
from pathlib import Path
import importlib.util,json,subprocess,tempfile
import numpy as np
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('minima',root/'tools/ski-trek/kartverket-minima.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);Policy=module.MinimumPolicy

def candidate(length,cost,offset=0):
 x=np.arange(0,10001,25);y=np.zeros(len(x));y[40:360]=offset
 return dict(seed=str(offset),points=np.column_stack([y,x]),validated=dict(distance_km=length/1000,weighted_cost_m=cost))
a=candidate(10000,12000);near=candidate(10500,11500,100);far=candidate(12000,13000,800);bad=candidate(15000,25000,-800);long=candidate(20001,11000,1600)
selected,report=Policy.select([a,near,far,bad,long])
assert report['maximum_distance_m']==20000
assert len(selected)==2 and {c['seed'] for c in selected}=={'100','800'}
assert {r['reason'] for r in report['rejected']}=={'length','cost','same geographic basin'}
assert Policy.separation(a['points'],far['points'],10000)['distinct']
assert not Policy.separation(a['points'],near['points'],10000)['distinct']
# A one-sided excursion must not pass as a distinct route.
loop=candidate(11000,12000);loop['points'][100:105,0]=1000
assert not Policy.separation(a['points'],loop['points'],10000)['distinct']
# Previously merged minima remain part of the shortest-known reference.
spec=importlib.util.spec_from_file_location('discovery',root/'tools/ski-trek/kartverket-discover-minima.py');discovery=importlib.util.module_from_spec(spec);spec.loader.exec_module(discovery)
with tempfile.TemporaryDirectory() as tmp:
 work=Path(tmp);points=np.array([[0,0],[0,10]],np.int32);points.tofile(work/'old.bin')
 start=dict(row=0,col=0);end=dict(row=0,col=10)
 record=dict(terrain_revision='test',local_refinement=dict(converged=True),start=start,end=end,pathfile='old.bin')
 (work/'minimum-history-test.json').write_text(json.dumps(record))
 planner=discovery.MinimumDiscovery.__new__(discovery.MinimumDiscovery);planner.root=work;planner.refiner=type('Refiner',(),dict(engine='test'))()
 assert len(list(planner.known_minima(start,end)))==1
 assert not list(planner.known_minima(end,start))
 # Shorter known minimum sets the limit even when it is later merged.
 selected,report=Policy.select([candidate(10000,12000),candidate(9000,12100,100)])
 assert report['maximum_distance_m']==18000 and len(selected)==1
with tempfile.TemporaryDirectory() as tmp:
 work=Path(tmp);binary=work/'basin';subprocess.run(['g++','-O2','-std=c++17',str(root/'tools/ski-trek/kartverket-basin.cpp'),'-o',str(binary)],check=True)
 h,w=400,500;slope=np.ones((h,w),np.uint16);slope[160:201,100:381]=1501
 slope.tofile(work/'slope.u16');np.ones((h,w),np.uint16).tofile(work/'heading-slope.u16');np.zeros((h,w),np.int16).tofile(work/'aspect.i16')
 points=np.array([(181,c) for c in range(41,442)],np.int32);points.tofile(work/'in.bin')
 subprocess.run([str(binary),str(work),str(w),str(h),'45',str(work/'in.bin'),str(work/'out.bin'),'90','30',str(work/'report.json')],check=True)
 result=json.loads((work/'report.json').read_text());q=np.fromfile(work/'out.bin',np.int32).reshape(-1,2)
 assert result['improved'] and result['cost_after_m']<result['cost_before_m']*.65
 assert result['distance_m']>400 # The old bound would forbid this cheaper route.
 assert np.array_equal(q[[0,-1]],points[[0,-1]]) and not result['distance_constrained']
 assert result['pinned_intermediate_points']==0
 # A second identical-width search must prove this whole corridor stable.
 subprocess.run([str(binary),str(work),str(w),str(h),'45',str(work/'out.bin'),str(work/'again.bin'),'90','30',str(work/'again.json')],check=True)
 assert not json.loads((work/'again.json').read_text())['improved']
print('Unpinned whole-route descent, cheaper longer detour, convergence, symmetric diversity and relative eligibility passed')
