"""Exercise the actual ordered-region graph, including native cliff checks."""
from pathlib import Path
import json,subprocess,tempfile
import numpy as np
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
 work=Path(tmp);binary=work/'corridor';subprocess.run(['g++','-O2','-std=c++17',str(root/'tools/ski-trek/kartverket-corridor.cpp'),'-o',str(binary)],check=True)
 field=np.ones((1001,1401),np.uint16);field.tofile(work/'slope.u16');field.tofile(work/'heading-slope.u16');np.zeros_like(field,dtype=np.int16).tofile(work/'aspect.i16')
 (work/'gates').write_text('200 400 100 1001 500\n200 1000 100 1001 0\n')
 args=[str(binary),str(work),'1401','1001','800','100','800','1300','45','2500','0',str(work/'gates'),str(work/'path.bin'),str(work/'hits.json'),'v1']
 result=subprocess.run(args,capture_output=True,text=True);assert result.returncode==0,result.stderr
 report=json.loads(result.stdout);hits=json.loads((work/'hits.json').read_text())['gate_indices'];p=np.fromfile(work/'path.bin',np.int32).reshape(-1,2)
 assert report['within_distance_limit'] and hits[1]>hits[0]
 for index,center in zip(hits,[(200,400),(200,1000)]):assert np.linalg.norm(p[index]-center)<=100
 assert p[hits[0]:,1].min()>=500
 field[:,700]=8101;field.tofile(work/'slope.u16');blocked=subprocess.run(args,capture_output=True,text=True)
 assert not json.loads(blocked.stdout)['feasible']
print('Ordered geographic gates, direction constraint and a one-metre cliff barrier passed')
