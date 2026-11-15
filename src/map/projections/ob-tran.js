// Spherical pole rotation from PROJ's ob_tran (Snyder equations 5-7 to 5-10).
// Copyright and license: licenses/PROJ.txt.
import {horizontalForward,horizontalInverse,HORIZONTAL_HALF_HEIGHT as K} from './peirce-horizontal.js'
const radians=Math.PI/180
const clamp=value=>Math.max(-1,Math.min(1,value))
const normalize=lon=>Math.atan2(Math.sin(lon),Math.cos(lon))
function wrap(value,width){return ((value+width/2)%width+width)%width-width/2}
export function registerOblique(proj4){
 proj4.Proj.projections.add({
  names:['ob_tran'],
  init(){
   if(this.o_proj!=='peirce_q')throw Error('Only ob_tran with o_proj=peirce_q is supported')
   if(this.shape && this.o_type && this.shape!==this.o_type)throw Error('Conflicting Peirce shape parameters')
   if((this.shape||this.o_type)!=='horizontal')throw Error('Only the horizontal Peirce shape is supported in ob_tran')
   if(this.scrollx!==undefined && this.o_scrollx!==undefined && Number(this.scrollx)!==Number(this.o_scrollx))throw Error('Conflicting Peirce scroll parameters')
   if(this.o_lat_p===undefined||this.o_lon_p===undefined)throw Error('ob_tran requires o_lat_p and o_lon_p')
   const lat=Number(this.o_lat_p),lon=Number(this.o_lon_p),scroll=Number(this.scrollx ?? this.o_scrollx ?? 0)
   if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||!Number.isFinite(scroll)||Math.abs(scroll)>1)throw Error('Invalid ob_tran pole or scroll')
   this.poleSin=Math.sin(lat*radians);this.poleCos=Math.cos(lat*radians);this.poleLongitude=lon*radians;this.scroll=scroll
   this.k0=this.k0??1
  },
  forward({x:lon,y:lat}){
   const sp=Math.sin(lat),cp=Math.cos(lat),cl=Math.cos(lon-(this.long0||0)),sl=Math.sin(lon-(this.long0||0))
   const rotatedLon=normalize(Math.atan2(cp*sl,this.poleSin*cp*cl+this.poleCos*sp)+this.poleLongitude)
   const rotatedLat=Math.asin(clamp(this.poleSin*sp-this.poleCos*cp*cl))
   let [x,y]=horizontalForward(rotatedLon,rotatedLat)
   if(this.scroll!==0)x=wrap(x+this.scroll*4*K,4*K)
   return {x:x*this.a*this.k0+(this.x0||0),y:y*this.a*this.k0+(this.y0||0)}
  },
  inverse({x,y}){
   x=(x-(this.x0||0))/(this.a*this.k0);y=(y-(this.y0||0))/(this.a*this.k0)
   if(this.scroll!==0)x=wrap(x-this.scroll*4*K,4*K)
   const [rotatedLon,rotatedLat]=horizontalInverse(x,y),lon=rotatedLon-this.poleLongitude
   const sp=Math.sin(rotatedLat),cp=Math.cos(rotatedLat),cl=Math.cos(lon)
   return {x:normalize(Math.atan2(cp*Math.sin(lon),this.poleSin*cp*cl-this.poleCos*sp)+(this.long0||0)),y:Math.asin(clamp(this.poleSin*sp+this.poleCos*cp*cl))}
  },
 })
}
