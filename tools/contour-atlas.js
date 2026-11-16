import '../src/map/projections/index.js?v=grieger-wrap'
import {get} from 'ol/proj.js'
import {buildAdaptiveContourAtlas} from '../src/map/reprojection/contour-atlas-builder.js?v=atlas-builder-v3'
window.generateContourAtlas=(code,coordinates)=>{
 const target=get(code),source=get('EPSG:3857'),coordinateProjection=coordinates==='source'?source:target
 return buildAdaptiveContourAtlas(target,source,{coordinateProjection,minQuarter:-80,maxQuarter:80})
}
document.querySelector('#generate').addEventListener('click',()=>{
 const code=document.querySelector('#projection').value,coordinates=document.querySelector('#coordinates').value,status=document.querySelector('#status')
 status.textContent=' Generating…'
 setTimeout(()=>{
  try{
   const data=window.generateContourAtlas(code,coordinates),url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),link=document.createElement('a')
   link.href=url;link.download=`${coordinates==='source'?'source-':''}${code.replace(/[^a-z\d]+/gi,'-').toLowerCase()}.json`;link.click();URL.revokeObjectURL(url)
   status.textContent=` Generated ${data.paths.length} paths.`
  }catch(error){status.textContent=` ${error.message}`;throw error}
 },0)
})
