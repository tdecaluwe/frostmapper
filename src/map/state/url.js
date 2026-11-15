import {transform} from 'ol/proj.js'
export function readState() {
 const url=new URL(location.href), m=url.searchParams.get('loc')?.match(/^@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)z$/)
 if(!m) return null
 const lat=+m[1],lon=+m[2],zoom=+m[3],rotation=Number(localStorage.getItem('frostmapper.rotation')||0)
 if(Math.abs(lat)>90||Math.abs(lon)>180||zoom< -10||zoom>28||!Number.isFinite(rotation)) return null
 return {center:[lon,lat],zoom,rotation,projection:localStorage.getItem('frostmapper.projection')||'EPSG:3857'}
}
export function syncUrl(map, apply) {
 let restoring=false
 const write=(push=false)=>{if(restoring)return; const view=map.getView(), c=transform(view.getCenter(),view.getProjection(),'EPSG:4326'); if(!c.every(Number.isFinite))return; const longitude=((c[0]+180)%360+360)%360-180; const u=new URL(location.href); u.searchParams.set('loc',`@${c[1].toFixed(6)},${longitude.toFixed(6)},${view.getZoom().toFixed(2)}z`); localStorage.setItem('frostmapper.projection',view.getProjection().getCode()); localStorage.setItem('frostmapper.rotation',view.getRotation().toFixed(4)); history[push?'pushState':'replaceState'](null,'',u)}
 map.on('moveend',()=>write(true)); window.addEventListener('popstate',()=>{const s=readState();if(s){restoring=true;apply(s);restoring=false}}); write()
}
