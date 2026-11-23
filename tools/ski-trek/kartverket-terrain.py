"""Download aligned 1 m NHM tiles with a derivative halo; keep unknown cells closed.
Native grid: EPSG:25832, cell centers at integer coordinates + 0.5 m.
Slope code 0 is unavailable; otherwise ceil(degrees*100)+1. Aspect is
rounded to 0.01 degree, clockwise from raster +x toward raster +y (south).
"""
from pathlib import Path
import concurrent.futures as cf
import io,json,math,subprocess,sys,time,urllib.request,zlib
import numpy as np
from PIL import Image

ROOT=Path(sys.argv[1]);ROOT.mkdir(exist_ok=True,parents=True)
TILE=1000;X0,X1,Y0,Y1=421000,450000,6875000,6914000
H,W=Y1-Y0,X1-X0
ENDPOINT='https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25832'
meta=dict(crs='EPSG:25832',resolution=1,xmin=X0,xmax=X1,ymin=Y0,ymax=Y1,width=W,height=H,tile_size=TILE,source=ENDPOINT)
if (ROOT/'meta.json').exists():
 previous=json.loads((ROOT/'meta.json').read_text())
 if any(previous.get(k)!=meta[k] for k in ('xmin','xmax','ymin','ymax','width','height')):raise ValueError('Working raster extent changed; use a new cache directory')
(ROOT/'meta.json').write_text(json.dumps(meta,indent=2))
slopes=np.memmap(ROOT/'slope.u16',dtype='uint16',mode='r+' if (ROOT/'slope.u16').exists() else 'w+',shape=(H,W))
aspects=np.memmap(ROOT/'aspect.i16',dtype='int16',mode='r+' if (ROOT/'aspect.i16').exists() else 'w+',shape=(H,W))
(ROOT/'terrain').mkdir(exist_ok=True)
data=json.loads(Path('data/ski-trek/exposure-routes.geojson').read_text())
features=sum((data.get(k,[]) for k in ['features','day1_options','day6_options','diagnostics','additional_routes']),[])
coords=[p[:2] for f in features for p in f['geometry']['coordinates']]
# Include rejected geometry for a coverage/obstacle regression, never as a route.
coords+=json.loads(Path('data/ski-trek/cliff-validation.json').read_text())['rejected_segment']
text=''.join(f'{x} {y}\n' for x,y in coords)
xy=np.loadtxt(subprocess.check_output(['gdaltransform','-s_srs','EPSG:4326','-t_srs','EPSG:25832'],input=text.encode()).decode().splitlines())[:,:2]
wanted=set()
for x,y in xy:
 for dx in range(-1,2):
  for dy in range(-1,2):
   tx,ty=int(x//TILE)+dx,int(y//TILE)+dy
   if X0<=tx*TILE<X1 and Y0<=ty*TILE<Y1:wanted.add((tx,ty))
# Every old straight segment is sampled too, including long flat stretches.
offset=0
for f in features:
 p=xy[offset:offset+len(f['geometry']['coordinates'])];offset+=len(p)
 for a,b in zip(p,p[1:]):
  for x,y in np.linspace(a,b,max(2,math.ceil(np.linalg.norm(a-b)/200))):
   for dx in range(-1,2):
    for dy in range(-1,2):
     tx,ty=int(x//TILE)+dx,int(y//TILE)+dy
     if X0<=tx*TILE<X1 and Y0<=ty*TILE<Y1:wanted.add((tx,ty))
if len(sys.argv)>2:
 wanted={tuple(v) for v in json.loads(Path(sys.argv[2]).read_text())}
start=time.monotonic();done=0;failures=[]
def build(tile):
 tx,ty=tile;out=ROOT/'terrain'/f'{tx}-{ty}.f32z';marker=out.with_suffix('.done')
 if marker.exists():return tile,False
 bbox=f'{tx*TILE-1},{ty*TILE-1},{(tx+1)*TILE+1},{(ty+1)*TILE+1}'
 url=f'{ENDPOINT}?service=WCS&request=GetCoverage&version=1.0.0&coverage=nhm_dtm_topo_25832&crs=EPSG:25832&bbox={bbox}&resx=1&resy=1&format=GeoTIFF'
 last=None
 for attempt in range(4):
  try:
   with urllib.request.urlopen(url,timeout=90) as r:blob=r.read()
   with Image.open(io.BytesIO(blob)) as image:h=np.array(image,dtype=np.float32)
   if h.shape!=(1002,1002):raise ValueError(f'Unexpected DTM shape {h.shape}')
   valid=np.isfinite(h)&(h>-100)&(h<9000)
   gx=(h[1:-1,2:]-h[1:-1,:-2])*.5;gy=(h[2:,1:-1]-h[:-2,1:-1])*.5
   s=np.degrees(np.arctan(np.hypot(gx,gy)));a=np.degrees(np.arctan2(gy,gx))
   good=valid[1:-1,2:]&valid[1:-1,:-2]&valid[2:,1:-1]&valid[:-2,1:-1]&valid[1:-1,1:-1]
   row=Y1-(ty+1)*TILE;col=tx*TILE-X0
   slopes[row:row+TILE,col:col+TILE]=np.where(good,np.ceil(s*100)+1,0).astype(np.uint16)
   aspects[row:row+TILE,col:col+TILE]=np.rint(a*100).astype(np.int16)
   out.write_bytes(zlib.compress(h[1:-1,1:-1].tobytes(),1))
   marker.write_text(url+'\n');return tile,True
  except Exception as e:last=e;time.sleep(min(attempt+1,3))
 raise RuntimeError(f'{tile}: {last}')
print(json.dumps(dict(tiles=len(wanted),grid=[H,W],start=True)),flush=True)
with cf.ThreadPoolExecutor(max_workers=4) as executor:
 futures={executor.submit(build,t):t for t in sorted(wanted)}
 for future in cf.as_completed(futures):
  try:tile,fetched=future.result();done+=1
  except Exception as e:failures.append(str(e));print(str(e),flush=True);continue
  if done%10==0:print(json.dumps(dict(done=done,total=len(wanted),seconds=round(time.monotonic()-start,1))),flush=True)
slopes.flush();aspects.flush();all_tiles=sorted(tuple(map(int,p.stem.split('-'))) for p in (ROOT/'terrain').glob('*.done'));(ROOT/'coverage.json').write_text(json.dumps(dict(tiles=all_tiles,requested_tiles=len(wanted),failures=failures,seconds=time.monotonic()-start)))
if failures:raise SystemExit(1)
