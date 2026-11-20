from pathlib import Path
import json,math,time,subprocess
import numpy as np
from PIL import Image
from scipy import ndimage
root=Path(__import__('sys').argv[1]);meta=json.loads((root/'meta.json').read_text());z=meta['z'];W=(meta['xmax']-meta['xmin']+1)*256;H=(meta['ymax']-meta['ymin']+1)*256
start=time.time()
if not (root/'slope.npy').exists():
 heights=np.empty((H,W),np.float32)
 for y in range(meta['ymin'],meta['ymax']+1):
  for x in range(meta['xmin'],meta['xmax']+1):
   rgb=np.asarray(Image.open(root/'tiles'/f'{z}-{x}-{y}.png'),dtype=np.float32)
   heights[(y-meta['ymin'])*256:(y-meta['ymin']+1)*256,(x-meta['xmin'])*256:(x-meta['xmin']+1)*256]=rgb[:,:,0]*256+rgb[:,:,1]+rgb[:,:,2]/256-32768
 world=2*math.pi*6378137;res=world/(256*2**z)
 rows=np.arange(H)+meta['ymin']*256+.5;my=world/2-rows*res;spacing=res/np.cosh(my/6378137)
 dy,dx=np.gradient(heights)
 slope=np.degrees(np.arctan(np.hypot(dx,dy)/spacing[:,None])).astype(np.float32)
 np.save(root/'height.npy',heights);np.save(root/'slope.npy',slope);spacing.astype(np.float64).tofile(root/'spacing.bin')
else:
 heights=np.load(root/'height.npy',mmap_mode='r');slope=np.load(root/'slope.npy',mmap_mode='r');spacing=np.fromfile(root/'spacing.bin',dtype=np.float64)
quantized=np.ceil(np.maximum(10,slope)*10).astype(np.uint16);quantized.tofile(root/'slope.bin')
print('Raster ready',H,W,'spacing',spacing.min(),spacing.max(),'seconds',time.time()-start,flush=True)
print('Hut pixel slopes',[(h['name'],float(slope[h['row'],h['col']])) for h in meta['huts']],flush=True)
