"""A 10 m fall-line field, separate from the untouched 1 m slope raster."""
from pathlib import Path
import functools,json,sys,time,zlib
import numpy as np
root=Path(sys.argv[1]);meta=json.loads((root/'meta.json').read_text());shape=(meta['height'],meta['width']);start=time.monotonic()
slope=np.memmap(root/'heading-slope.u16',dtype='uint16',mode='w+',shape=shape)
aspect=np.memmap(root/'aspect.i16',dtype='int16',mode='r+',shape=shape)
@functools.lru_cache(maxsize=32)
def heights(tx,ty):
 p=root/'terrain'/f'{tx}-{ty}.f32z'
 if not p.exists():return None
 h=np.frombuffer(zlib.decompress(p.read_bytes()),dtype=np.float32).reshape(1000,1000)
 return np.where(np.isfinite(h)&(h>-100)&(h<9000),h,np.nan)
for i,p in enumerate(sorted((root/'terrain').glob('*.done'))):
 tx,ty=map(int,p.stem.split('-'));halo=np.full((1010,1010),np.nan,np.float32)
 for ox in [-1,0,1]:
  for oy in [-1,0,1]:
   tile=heights(tx+ox,ty-oy)
   if tile is None:continue
   # oy is positive toward raster south; tile y numbering increases north.
   left,top=ox*1000+5,oy*1000+5
   a,b=max(0,left),max(0,top);c,d=min(1010,left+1000),min(1010,top+1000)
   if a<c and b<d:halo[b:d,a:c]=tile[b-top:d-top,a-left:c-left]
 gx=(halo[5:1005,10:1010]-halo[5:1005,:1000])/10
 gy=(halo[10:1010,5:1005]-halo[:1000,5:1005])/10
 s=np.degrees(np.arctan(np.hypot(gx,gy)));a=np.degrees(np.arctan2(gy,gx));valid=np.isfinite(s)
 row=meta['ymax']-(ty+1)*1000;col=tx*1000-meta['xmin']
 slope[row:row+1000,col:col+1000]=np.where(valid,np.ceil(np.nan_to_num(s)*100)+1,0).astype(np.uint16)
 aspect[row:row+1000,col:col+1000]=np.rint(np.nan_to_num(a)*100).astype(np.int16)
 if (i+1)%100==0:print(i+1,round(time.monotonic()-start,1),flush=True)
slope.flush();aspect.flush();print('heading done',time.monotonic()-start,flush=True)
