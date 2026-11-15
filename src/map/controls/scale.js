import {transform} from 'ol/proj.js'
import {getDistance} from 'ol/sphere.js'
export function attachScale(map){
 const label=document.querySelector('#scale-label'),bar=document.querySelector('#scale-bar');let pixel
 function update(){const size=map.getSize();if(!size)return;const p=pixel||[size[0]/2,size[1]/2];const a=map.getCoordinateFromPixel(p),b=map.getCoordinateFromPixel([p[0]+50,p[1]]);const proj=map.getView().getProjection();const meters=getDistance(transform(a,proj,'EPSG:4326'),transform(b,proj,'EPSG:4326'))/50;if(!Number.isFinite(meters)||meters<=0)return;const target=meters*120, power=10**Math.floor(Math.log10(target));const distance=[1,2,5,10].map(n=>n*power).reduce((a,b)=>Math.abs(a-target)<Math.abs(b-target)?a:b);bar.style.width=`${distance/meters}px`;label.textContent=distance>=1000?`${distance/1000} km`:`${distance} m`}
 map.on(['pointermove','pointerdown'],e=>{pixel=e.pixel;update()});map.on('postrender',update)
}
