from pathlib import Path
import runpy,sys,json,numpy as np
module=runpy.run_path(str(Path(__file__).with_name('kartverket-routes.py')),run_name='driver');run=module['run'];h=module['huts'];root=module['root']
for id,index,bound in [('TJN',6,30000),('TMN',7,15000)]:run(id,h[5],h[index],cap=45,bound=bound)
def read(id):
 status=json.loads((root/f'published-{id}-0.json').read_text());p=np.fromfile(root/status['pathfile'],np.int32).reshape(-1,2);return status,p
vj,vjpath=read('VJ');jm,jmpath=read('JM')
for leg,id,tail in [('TJN','RJVN',vjpath[::-1]),('TMN','RMVN',np.concatenate([jmpath[::-1],vjpath[::-1][1:]]))]:
 source=root/f'{leg}-le2-p250-h10-cap45-w1-m4.json';status=json.loads(source.read_text())
 if not status['feasible']:continue
 p=np.fromfile(root/status['pathfile'],np.int32).reshape(-1,2);assert np.array_equal(p[-1],tail[0]);p=np.concatenate([p,tail[1:]])
 length=np.hypot(*np.diff(p,axis=0).T).sum()
 if length>35000:continue
 filename=f'{id}-le2-p250-h10-cap45-w1-m4';p.tofile(root/(filename+'.bin'));status.update(id=id,pathfile=filename+'.bin',end=h[4],bound=35000,distance_m=float(length));(root/(filename+'.json')).write_text(json.dumps(status,indent=2));print(id,length,flush=True)
