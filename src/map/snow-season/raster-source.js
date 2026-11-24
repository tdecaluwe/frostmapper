import ImageSource from 'ol/source/Image.js'
import ImageCanvas from 'ol/ImageCanvas.js'
import {snowColor} from './grid.js'
/** A tiny native-cell raster, rebuilt only on worker updates or metric changes.
 * OL handles its projection; no statistics/network work enters the render loop. */
export class SnowSeasonRasterSource extends ImageSource{
 constructor(){super({projection:'EPSG:32633',interpolate:false,attributions:'Snow season estimates: Frostmapper · <a href="https://www.senorge.no/">NVE seNorge</a> (NLOD)'});this.raster=null}
 update(extent,records,metric){
  if(!extent){this.raster=null;this.changed();return}
  const [left,bottom,right,top]=extent,width=(right-left)/1000,height=(top-bottom)/1000
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
  const ctx=canvas.getContext('2d'),image=ctx.createImageData(width,height)
  for(const [key,record] of records){
   const [x,y]=key.split('/').map(Number),col=x-left/1000,row=top/1000-y-1
   if(col<0||col>=width||row<0||row>=height)continue
   const color=snowColor(record,metric);if(!color)continue
   const i=(row*width+col)*4;image.data.set([...color,255],i)
  }
  ctx.putImageData(image,0,0);this.raster=new ImageCanvas(extent,1000,1,canvas);this.changed()
 }
 getImageInternal(){return this.raster}
}
