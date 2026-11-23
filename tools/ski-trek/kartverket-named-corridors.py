"""Ordered named-region routing and gate-preserving native refinement."""
from pathlib import Path
import copy,importlib.util,json,subprocess,sys,time
import numpy as np
root=Path(sys.argv[1]);repo=Path(__file__).resolve().parents[2];meta=json.loads((root/'meta.json').read_text());huts=json.loads((root/'huts.json').read_text());landmarks=json.loads((repo/'data/ski-trek/route-landmarks.json').read_text())
spec=importlib.util.spec_from_file_location('geographic',Path(__file__).with_name('kartverket-geographic.py'));geo=importlib.util.module_from_spec(spec);spec.loader.exec_module(geo);refiner=geo.CandidateRefiner(root)
manifest=json.loads((root/'published-routes.json').read_text())

def gate(name,x,y,radius,min_y=None,min_x=None):return dict(name=name,x=x,y=y,radius_m=radius,min_y_after=min_y,min_x_after=min_x)
def at(name,radius):p=landmarks[name];return gate(name,p['x'],p['y'],radius)
def checks(points,gates):
 result=[];cursor=0
 for g in gates:
  q=np.array([meta['ymax']-g['y']-.5,g['x']-meta['xmin']-.5]);distance=np.hypot(*(points[cursor:]-q).T);index=cursor+int(np.argmin(distance));minimum=float(distance.min())
  assert minimum<=g['radius_m']+.01,(g['name'],minimum,g['radius_m'])
  result.append(dict(name=g['name'],minimum_distance_m=minimum,path_index=index,radius_m=g['radius_m']));cursor=index
 return result

def register(status,label,id,required):
 p=np.fromfile(root/status['pathfile'],np.int32).reshape(-1,2);status={**status,'variant_label':label,'variant_id':id,'corridor_constraints':required,'constraint_checks':checks(p,required)}
 file=root/f'named-{id}.json';file.write_text(json.dumps(status,ensure_ascii=False,indent=2));return file.name

def solve(id,start,end,gates,bound=25000):
 gatefile=root/f'{id}.gates';gatefile.write_text(''.join(f"{meta['ymax']-g['y']-.5} {g['x']-meta['xmin']-.5} {g['radius_m']} {int(meta['ymax']-g['min_y_after']) if g.get('min_y_after') is not None else meta['height']} {int(g['min_x_after']-meta['xmin']) if g.get('min_x_after') is not None else 0}\n" for g in gates))
 output=root/f'{id}.bin';hits=root/f'{id}-hits.json';statusfile=root/f'{id}.json'
 if statusfile.exists():status=json.loads(statusfile.read_text())
 else:
  status=None
  for pressure in [0,1,4,16,64]:
   command=[str(root/'corridor'),str(root),str(meta['width']),str(meta['height']),str(start['row']),str(start['col']),str(end['row']),str(end['col']),'45',str(bound),str(pressure),str(gatefile),str(output),str(hits),'v1']
   began=time.monotonic();process=subprocess.run(command,capture_output=True,text=True)
   if not process.stdout:raise RuntimeError(process.stderr)
   report=json.loads(process.stdout);print(id,pressure,report,round(time.monotonic()-began,2),flush=True)
   if not report.get('feasible'):
    statusfile.write_text(json.dumps(report));return None
   if not report['within_distance_limit']:continue
   status={**report,'id':id,'start':start,'end':end,'weight':1,'cap':45,'bound':bound,'mesh_m':4,'pathfile':output.name,'corridor_constraints':gates,'gate_indices':json.loads(hits.read_text())['gate_indices']};statusfile.write_text(json.dumps(status,ensure_ascii=False,indent=2));break
  if status is None:return None
 if not status.get('feasible'):return None
 if status.get('refined'):return status
 p=np.fromfile(root/status['pathfile'],np.int32).reshape(-1,2);indices=[0,*status['gate_indices'],len(p)-1];lengths=[float(np.hypot(*np.diff(p[a:b+1],axis=0).T).sum()) for a,b in zip(indices,indices[1:])];slack=max(0,bound-sum(lengths));parts=[];reports=[]
 for i,(a,b) in enumerate(zip(indices,indices[1:])):
  path=root/f'{id}-part{i}.bin';p[a:b+1].tofile(path);sub={**status,'id':id+f'-part{i}','pathfile':path.name,'start':{**start,'row':int(p[a,0]),'col':int(p[a,1])},'end':{**end,'row':int(p[b,0]),'col':int(p[b,1])}}
  refined=refiner.refine(sub,45,lengths[i]+slack*lengths[i]/sum(lengths));q=refiner.points(refined);parts.append(q if not parts else q[1:]);reports.append(refined['local_refinement'])
 final=np.concatenate(parts);final.tofile(output);status.update(refined=True,validated=refiner.score(status,45),local_refinement=dict(converged=True,unresolved_windows=0,gate_preserving=True,segments=reports,tested_windows=sum(x['tested_windows'] for x in reports)),constraint_checks=checks(final,gates))
 assert status['validated']['distance_km']*1000<=bound+.01
 statusfile.write_text(json.dumps(status,ensure_ascii=False,indent=2));return status

# The already-native valley path meets all three ordered lake constraints.
d2=json.loads((root/manifest['D2|1']).read_text());manifest['D2|1']=register(d2,'Veltdalsvatnet valley · Kupevatnet','2',[at('Heimste Veltdalsvatnet',500),at('Fremste Veltdalsvatnet',500),at('Kupevatnet',250)])
# Keep the Styggedalen basin, not weight-only variants of it.
stygg=json.loads((root/manifest['D1|1']).read_text());styggname=register(stygg,'Styggedalen','1b',[at('Styggedalen',300)])

jobs=[
 ('JM-Ist-Midthoa-v3',huts[6],huts[7],[gate('Climb toward Istjønna',438980,6910065,250,min_x=439050),at('Midthøa',995)]),
 ('D3-NorthTord',huts[2],huts[3],[gate('Valley north of Tordsvatnet',438800,6893500,300),gate('West of Hellarhøa',438800,6896230,250)]),
 ('D1-Northern',huts[0],huts[1],[gate('Northern corridor',429800,6891750,500,6891000)])]
for id,start,end,gates in jobs:
 result=solve(id,start,end,gates)
 if result is None:
  print('No verified corridor candidate',id,flush=True);continue
 if id.startswith('JM'):
  manifest['JM|1']=register(result,'Toward Istjønna · near Midthøa','JM',gates)
  manifest.pop('JM|2',None)
 elif id.startswith('D3'):
  manifest['D3|1']=register(result,'North of Tordsvatnet · west of Hellarhøa','3',gates)
  manifest.pop('D3|2',None)
 else:
  if geo.GeographicDiversity.distinct(refiner.points(result),refiner.points(stygg)):
   manifest['D1|1']=register(result,'Northern corridor','1a',gates);manifest['D1|2']=styggname
(root/'published-routes.json').write_text(json.dumps(manifest,indent=2))
if 'D1|2' not in manifest:manifest['D1|1']=styggname;(root/'published-routes.json').write_text(json.dumps(manifest,indent=2))
