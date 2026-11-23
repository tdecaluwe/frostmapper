"""Search lower-valley diversions, keeping the return under 35 km."""
import json,math,runpy,sys
from pathlib import Path
import numpy as np
# The shared driver owns projection conversion, metadata and search execution.
module=runpy.run_path(str(Path(__file__).with_name('kartverket-routes.py')),run_name='kartverket_driver')
root=module['root'];run=module['run'];huts=module['huts'];meta=module['m']
p=np.fromfile(root/'D5-le2-p250-h10-cap29.5-w1-m4.bin',np.int32).reshape(-1,2)
delta=np.diff(p,axis=0);chain=np.r_[0,np.cumsum(np.hypot(delta[:,0],delta[:,1]))]
mesh=4;shape=((meta['height']-1)//mesh+1,(meta['width']-1)//mesh+1)
for id,fraction,radius,grade in [('RFA',.2,1000,1),('RGA',.55,1000,1),('RFB',.1,750,1),('RGB',.7,750,1)]:
 row,col=p[np.searchsorted(chain,fraction*chain[-1])];mask=np.zeros(shape,np.uint8)
 a=max(0,int((row-radius)//mesh)-1);b=min(shape[0],int((row+radius)//mesh)+2)
 c=max(0,int((col-radius)//mesh)-1);d=min(shape[1],int((col+radius)//mesh)+2)
 yy=np.arange(a,b)[:,None]*mesh;xx=np.arange(c,d)[None,:]*mesh
 mask[a:b,c:d]=np.hypot(yy-row,xx-col)<radius
 filename=root/f'{id}-gate.u8';mask.tofile(filename);del mask
 result=run(id,huts[5],huts[4],cap=45,weight=grade,bound=35000,mask=str(filename))
 result.update(gate_row=int(row),gate_col=int(col),gate_radius_m=radius)
 (root/Path(result['pathfile']).with_suffix('.json')).write_text(json.dumps(result,indent=2,ensure_ascii=False))
