import subprocess,re,json,math,concurrent.futures,time,os
from pathlib import Path
root=Path(__import__('sys').argv[1]);(root/'tiles').mkdir(exist_ok=True)
names=['Danskehytta','Veltdalshytta','Torsbu','Pyttbua','Vakkerstøylen','Tjønnebu']
utms=[(423189,6886769),(433341,6892595),(439924,6888545),(437515,6898458),(439349,6904654),(430959,6910650)]
converted=subprocess.check_output(['gdaltransform','-s_srs','EPSG:32632','-t_srs','EPSG:4326'],input=''.join(f'{x} {y}\n' for x,y in utms).encode()).decode().splitlines()
huts=[dict(name=n,lon=float(c.split()[0]),lat=float(c.split()[1])) for n,c in zip(names,converted)]
z=13;n=2**z
px=lambda lon:(lon+180)/360*n*256
py=lambda lat:(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n*256
west=min(h['lon'] for h in huts)-.25;east=max(h['lon'] for h in huts)+.25
south=min(h['lat'] for h in huts)-.115;north=max(h['lat'] for h in huts)+.115
xmin=int(px(west)//256);xmax=int(px(east)//256);ymin=int(py(north)//256);ymax=int(py(south)//256)
for h in huts:h.update(col=round(px(h['lon'])-xmin*256-.5),row=round(py(h['lat'])-ymin*256-.5))
meta=dict(z=z,xmin=xmin,xmax=xmax,ymin=ymin,ymax=ymax,huts=huts)
(root/'meta.json').write_text(json.dumps(meta,indent=2));print(meta,flush=True)
tiles=[(x,y) for y in range(ymin,ymax+1) for x in range(xmin,xmax+1)]
def download(pair):
 x,y=pair;p=root/'tiles'/f'{z}-{x}-{y}.png'
 if p.exists() and p.stat().st_size>100:return
 u=f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
 subprocess.run(['curl','-fsSL','--retry','2','--max-time','45',u,'-o',str(p)],check=True,stdout=subprocess.DEVNULL)
t=time.time()
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
 for i,_ in enumerate(pool.map(download,tiles)):
  if i%30==0:print(f'downloaded {i+1}/{len(tiles)} in {time.time()-t:.1f}s',flush=True)
print('DONE',len(tiles),time.time()-t,flush=True)
