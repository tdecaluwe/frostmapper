import '../src/map/projections/index.js?v=grieger-wrap'
import Map from 'ol/Map.js'
import XYZ from 'ol/source/XYZ.js'
import TileState from 'ol/TileState.js'
import {get} from 'ol/proj.js'
import {createMapView} from '../src/map/projections/view.js?v=viewport-model'
import {guardReprojection,estimateStitchSize,MAX_SOURCE_AREA_RATIO,MAX_NATIVE_SOURCE_AREA_RATIO} from '../src/map/layers/reprojection-budget.js?v=contour-bands'
import {ContourReprojection} from '../src/map/reprojection/contour-reprojection.js'
import {CompositeTile} from '../src/map/reprojection/composite-tile.js'
const errors=[],target=get('EPSG:3035'),map=new Map({target:'map',layers:[],controls:[],view:createMapView('EPSG:3035',[10,52],3)})
const source=new XYZ({projection:'EPSG:3857',tileUrlFunction:([z])=>`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${z%2?'red':'blue'}"/></svg>`)}`,maxZoom:12,crossOrigin:'anonymous'})
guardReprojection(source)
const bands=new ContourReprojection(map);bands.addSource(source)
for(let n=0;n<100&&!bands.atlases.get('EPSG:3035');n++)await new Promise(resolve=>setTimeout(resolve,20))
const atlas=bands.atlases.get('EPSG:3035'),grid=source.getTileGridForProjection(target)
let composite
if(!atlas)errors.push('atlas did not load')
if(atlas){
 for(let phase=0;phase<4&&!composite;phase++){
  bands.setSignature(`EPSG:3035|${phase}`)
  for(const segment of atlas.query([0,0,1,1],phase)){
   const c=segment.curve,e=atlas.data.extent,point=[e[0]+((c[0]+c[6])/2)*(e[2]-e[0]),e[1]+((c[1]+c[7])/2)*(e[3]-e[1])]
   for(const z of [3,4,5,6]){
    const coord=grid.getTileCoordForCoordAndZ(point,z),tile=source.getTile(...coord,1,target)
    if(tile instanceof CompositeTile){composite=tile;break}
    tile.release()
   }
   if(composite)break
  }
 }
 if(!composite)errors.push('no crossing tile was composed')
}
if(composite){
 const count=composite.children.size,sourceGrid=source.getTileGridForProjection(source.getProjection()),outputArea=composite.width*composite.height
 for(const child of composite.children.values())if(child.triangulation_&&child.sourceTileGrid_){
  const extent=child.triangulation_.calculateSourceExtent(),[width,height]=estimateStitchSize(extent,source.getProjection(),sourceGrid,child.sourceZ_,1)
  const scale=sourceGrid.getResolution(child.sourceZ_)/child.sourceTileGrid_.getResolution(child.sourceZ_)
  if(Math.round(width)*Math.round(height)>outputArea*MAX_NATIVE_SOURCE_AREA_RATIO/count)errors.push('composite exceeded native source budget')
  if(Math.round(width*scale)*Math.round(height*scale)>outputArea*(MAX_SOURCE_AREA_RATIO-count-1))errors.push('composite exceeded stitch budget')
 }
 composite.load()
 for(let n=0;n<200&&[TileState.IDLE,TileState.LOADING].includes(composite.getState());n++)await new Promise(resolve=>setTimeout(resolve,20))
 if(composite.getState()!==TileState.LOADED)errors.push(`crossing tile state ${composite.getState()}`)
 else{
  const canvas=composite.getImage(),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data
  let red=0,blue=0,empty=0
  for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]===0)empty++;else if(pixels[i]>pixels[i+2])red++;else if(pixels[i+2]>pixels[i])blue++}
  if(!red||!blue)errors.push(`expected two source zoom colors: red ${red}, blue ${blue}, empty ${empty}`)
 }
 composite.release()
}
map.setTarget(undefined)
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed contour reprojection integration checks'
if(errors.length)throw Error(errors.join('\n'))
