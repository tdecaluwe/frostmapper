import '../src/map/projections/index.js?v=grieger-wrap'
import {get} from 'ol/proj.js'
import {ContourAtlasBuilder} from '../src/map/reprojection/contour-atlas.js?v=fixed-bands'
window.generateContourAtlas=code=>new ContourAtlasBuilder(get(code),get('EPSG:3857')).build()
document.querySelector('#generate').addEventListener('click',()=>{
 const code=document.querySelector('#projection').value,status=document.querySelector('#status')
 status.textContent=' Generating…'
 setTimeout(()=>{
  try{
   const data=window.generateContourAtlas(code),url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),link=document.createElement('a')
   link.href=url;link.download=code.replace(/[^a-z\d]+/gi,'-').toLowerCase()+'.json';link.click();URL.revokeObjectURL(url)
   status.textContent=` Generated ${data.paths.length} paths.`
  }catch(error){status.textContent=` ${error.message}`;throw error}
 },0)
})
