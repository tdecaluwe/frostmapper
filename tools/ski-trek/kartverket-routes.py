import json,math,subprocess,time,resource,sys
from pathlib import Path
root=Path(sys.argv[1]);m=json.loads((root/'meta.json').read_text())
configuration=Path(sys.argv[2]) if len(sys.argv)>2 else Path('data/ski-trek/huts.json')
if configuration.is_dir():
 huts=json.loads((configuration/'meta.json').read_text())['huts'];legs=json.loads((configuration/'extra-legs.json').read_text());huts +=[legs[1][2],legs[2][2]]
else:huts=json.loads(configuration.read_text())
text=''.join(f"{h['lon']} {h['lat']}\n" for h in huts)
xy=[list(map(float,line.split()[:2])) for line in subprocess.check_output(['gdaltransform','-s_srs','EPSG:4326','-t_srs','EPSG:25832'],input=text.encode()).decode().splitlines()]
for h,(x,y) in zip(huts,xy):h.update(x=x,y=y,row=round(m['ymax']-y-.5),col=round(x-m['xmin']-.5))
(root/'huts.json').write_text(json.dumps(huts,indent=2,ensure_ascii=False))
def run(id,a,b,cap=29.5,weight=1,bound=25000,mesh=4,radius=3,mask='-',pressure=0):
 name=f'{id}-le2-p250-h10-cap{cap}-w{weight}-m{mesh}'+(f'-l{pressure}' if pressure else '');path=root/f'{name}.bin';status=root/f'{name}.json'
 if status.exists():print('cached',name,flush=True);return json.loads(status.read_text())
 command=[str(root/'search'),str(root),str(m['width']),str(m['height']),str(a['row']),str(a['col']),str(b['row']),str(b['col']),str(cap),str(weight),str(bound),str(mesh),str(radius),mask,str(path),str(pressure)]
 start=time.monotonic();before=resource.getrusage(resource.RUSAGE_CHILDREN);process=subprocess.run(command,capture_output=True,text=True)
 if not process.stdout:raise RuntimeError(process.stderr)
 result=json.loads(process.stdout)
 result['geometry_feasible']=result['feasible'];result['feasible']=result['feasible'] and result.get('within_distance_limit',False)
 result.update(id=id,start=a,end=b,cap=cap,weight=weight,bound=bound,mesh_m=mesh,pathfile=path.name,seconds=time.monotonic()-start,stderr=process.stderr)
 after=resource.getrusage(resource.RUSAGE_CHILDREN)
 result.update(batch_peak_rss_mb=after.ru_maxrss/1024,cpu_seconds=after.ru_utime+after.ru_stime-before.ru_utime-before.ru_stime)
 if pressure==0 and result['geometry_feasible'] and not result['feasible']:
  for value in [1,4,16,64]:
   candidate=run(id,a,b,cap,weight,bound,mesh,radius,mask,pressure=value)
   if candidate['feasible']:
    import shutil
    shutil.copy2(root/candidate['pathfile'],path)
    result.update(feasible=True,within_distance_limit=True,distance_m=candidate['distance_m'],weighted_cost_m=candidate['weighted_cost_m'],distance_above_15_m=candidate['distance_above_15_m'],max_slope_deg=candidate['max_slope_deg'],selected_from=candidate['pathfile'],distance_pressure=value)
    break
 result['total_seconds']=time.monotonic()-start
 status.write_text(json.dumps(result,indent=2,ensure_ascii=False));print(json.dumps({k:v for k,v in result.items() if k not in ['start','end','stderr']}),flush=True);return result
if __name__=='__main__':
 for id,a,b in [('D1',huts[0],huts[1]),('D2',huts[1],huts[2]),('D3',huts[2],huts[3]),('D4',huts[3],huts[4]),('D5',huts[4],huts[5]),('VP',huts[1],huts[3]),('VJ',huts[4],huts[6]),('JM',huts[6],huts[7])]:
  for grade in [1,2]:
   result=run(id,a,b,weight=grade)
   if id=='D1' and not result['feasible']:run(id,a,b,weight=grade,cap=45)
 for bound in [25000,35000]:run(f'T{int(bound/1000)}',huts[0],huts[2],cap=20,bound=bound)
