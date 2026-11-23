"""Check actual local rerouting plus geometric diversity, without network."""
from pathlib import Path
import importlib.util,json,subprocess,tempfile
import numpy as np
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('geographic',root/'tools/ski-trek/kartverket-geographic.py');geo=importlib.util.module_from_spec(spec);spec.loader.exec_module(geo)
a=np.column_stack([np.zeros(401),np.arange(401)*25]);near=a.copy();near[:,0]=100
assert not geo.GeographicDiversity.distinct(a,near)
far=a.copy();far[80:240,0]=800
assert geo.GeographicDiversity.distinct(a,far)
spike=a.copy();spike[80:96,0]=800
assert not geo.GeographicDiversity.distinct(a,spike)
with tempfile.TemporaryDirectory() as name:
 work=Path(name);binary=work/'local';subprocess.run(['g++','-O2','-std=c++17',str(root/'tools/ski-trek/kartverket-local.cpp'),'-o',str(binary)],check=True)
 flat=np.ones((1400,2600),np.uint16);flat.tofile(work/'slope.u16');flat.tofile(work/'heading-slope.u16');np.zeros_like(flat,dtype=np.int16).tofile(work/'aspect.i16')
 points=[(500,100)]
 for target in [(500,900),(700,900),(700,1700),(500,1700),(500,2300)]:
  while points[-1]!=target:
   r,c=points[-1];points.append((r+int(np.sign(target[0]-r))*4,c+int(np.sign(target[1]-c))*4))
 p=np.array(points,np.int32);p.tofile(work/'input.bin')
 subprocess.run([str(binary),str(work),'2600','1400','45','3000',str(work/'input.bin'),str(work/'output.bin'),str(work/'local.json')],check=True)
 q=np.fromfile(work/'output.bin',np.int32).reshape(-1,2);report=json.loads((work/'local.json').read_text())
 length=lambda a:np.hypot(*np.diff(a,axis=0).T).sum()
 assert report['improvements']>0 and report['converged'] and report['unresolved_windows']==0
 assert length(q)<length(p)-100 and np.array_equal(p[[0,-1]],q[[0,-1]])
print('Local rerouting removes a costly detour; close variants and short spikes fail geographic diversity')
