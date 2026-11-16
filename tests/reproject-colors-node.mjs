// Install once: npm install --prefix tests/node-deps --no-audit --no-fund
// Run: node tests/reproject-colors-node.mjs
import {register,createRequire} from 'node:module'
import {resolve} from 'node:path'
import {mkdir,writeFile} from 'node:fs/promises'
register('./node-real-ol-loader.mjs',import.meta.url)
const root=process.env.FROST_TEST_NODE_MODULES||resolve('tests/node-deps/node_modules')
const require=createRequire(resolve(root,'../package.json'))
const {createCanvas}=require('@napi-rs/canvas')
globalThis.document={createElement(name){if(name!=='canvas')throw Error(`Unexpected element ${name}`);return createCanvas(300,150)}}
await import('../src/map/projections/index.js?v=grieger-wrap')
const {default:XYZ}=await import('ol/source/XYZ.js')
const {default:Tile}=await import('ol/Tile.js')
const {default:TileState}=await import('ol/TileState.js')
const {get,transform}=await import('ol/proj.js')
const {guardReprojection}=await import('../src/map/layers/reprojection-budget.js?v=contour-bands')
const {ContourReprojection}=await import('../src/map/reprojection/contour-reprojection.js?v=source-loads')
const {ContourAtlas}=await import('../src/map/reprojection/contour-atlas.js?v=fixed-bands')
const {BandMaskPlanner}=await import('../src/map/reprojection/band-mask.js')
const colors=Array.from({length:18},(_,z)=>[10+13*z,(30+71*z)%256,(50+137*z)%256])
class SolidTile extends Tile{
 constructor(coord){super(coord,TileState.IDLE);this.canvas=createCanvas(256,256);const ctx=this.canvas.getContext('2d'),[r,g,b]=colors[coord[0]];ctx.fillStyle=`rgb(${r},${g},${b})`;ctx.fillRect(0,0,256,256)}
 load(){if(this.state===TileState.IDLE){this.state=TileState.LOADED;this.changed()}}
 getImage(){return this.canvas}
}
const source=new XYZ({projection:'EPSG:3857',maxZoom:17,tileUrlFunction:()=>''})
source.getTileInternal=(z,x,y)=>new SolidTile([z,x,y])
guardReprojection(source)
const target=get('FROST:TRIPTYCHIAL'),src=get('EPSG:3857')
let activeProjection=get('EPSG:3857')
const manager=new ContourReprojection({on(){},getView(){return {getProjection:()=>activeProjection}}})
const directPlanner=new BandMaskPlanner()
function planWithSplits(atlas,request,makeChildren,depth=0){
 const spans=directPlanner.plan(atlas,request.extent,request.width,request.height,request.anchor,{minimumQuarter:request.minimumQuarter})
 if(spans||depth>=4||!makeChildren)return spans
 const packed=[]
 for(const child of makeChildren()){
  const childSpans=planWithSplits(atlas,child.request,child.makeChildren,depth+1)
  if(!childSpans)return null
  if(ArrayBuffer.isView(childSpans)){for(let i=0;i<childSpans.length;i+=4)packed.push(childSpans[i]+child.offset[0],childSpans[i+1]+child.offset[1],childSpans[i+2],childSpans[i+3])}
  else for(const span of childSpans)packed.push(span.x+child.offset[0],span.y+child.offset[1],span.width,span.band)
 }
 return Int32Array.from(packed)
}
const read=name=>JSON.parse(require('fs').readFileSync(name==='source-frost-triptychial.json'&&process.env.FROSTMAPPER_ATLAS?process.env.FROSTMAPPER_ATLAS:new URL(`./fixtures/contours/${name}`,import.meta.url),'utf8'))
manager.zoomSupervisor.register(target.getCode(),'EPSG:3857','source').data=read('source-frost-triptychial.json')
manager.planWorker={revision:0,register(){},peek(){return null},enqueue(id,key,makeRequest,source,makeChildren){const request=makeRequest(),atlas=manager.zoomSupervisor.getAtlas(target.getCode(),'EPSG:3857','source');return {ready:true,complete:true,spans:planWithSplits(new ContourAtlas(atlas),request,makeChildren)}}}
manager.addSource(source)
const assembler=manager.assemblers.get(source),assemble=assembler.getTile.bind(assembler),sourceTiles=[]
assembler.getTile=function(z,x,y,pixelRatio,projection,options){
 const extent=sourceGrid.getTileCoordExtent([z,x,y])
 sourceTiles.push({extent,reference:options.reference,minimumZoom:options.minimumZoom,maximumZoom:options.maximumZoom,spans:options.spans,anchor:manager.field(target,src).atSource([(extent[0]+extent[2])/2,(extent[1]+extent[3])/2])})
 return assemble(z,x,y,pixelRatio,projection,options)
}
activeProjection=target;manager.setSignature(target.getCode())
const targetGrid=source.getTileGridForProjection(target),sourceGrid=source.getTileGridForProjection(src),field=manager.field(target,src),results=[]
// A tile containing the Galápagos singularity plus its three neighbors.
for(const coord of [[5,7,0],[5,8,0],[5,7,1],[5,8,1]]){
 sourceTiles.length=0
 const tile=source.getTile(...coord,1,target),initial=tile.getState()
 if(initial===TileState.IDLE){await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error(`tile ${coord} timed out`)),15000);const done=()=>{const state=tile.getState();if(state===TileState.LOADED||state===TileState.ERROR||state===TileState.EMPTY){clearTimeout(timeout);tile.removeEventListener('change',done);resolve()}};tile.addEventListener('change',done);tile.load();done()})}
 if(tile.getState()!==TileState.LOADED){results.push({coord,state:tile.getState(),checked:0,wrong:0});continue}
 const canvas=tile.getImage(),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,extent=targetGrid.getTileCoordExtent(coord),reference=Math.round(Math.log2(sourceGrid.getResolution(0)/targetGrid.getResolution(coord[0])))
 if(process.env.FROST_TEST_OUTPUT){await mkdir(process.env.FROST_TEST_OUTPUT,{recursive:true});await writeFile(resolve(process.env.FROST_TEST_OUTPUT,`grieger-${coord.join('-')}.png`),canvas.toBuffer('image/png'))}
 let checked=0,wrong=0,unreadable=0;const examples=[],transitions={},bounds=[Infinity,Infinity,-Infinity,-Infinity]
 for(let y=2;y<canvas.height;y+=4)for(let x=2;x<canvas.width;x+=4){
  const q=field.at([extent[0]+(x+.5)/canvas.width*(extent[2]-extent[0]),extent[3]-(y+.5)/canvas.height*(extent[3]-extent[1])])
  if(q===null||Math.abs(q-Math.round(q))<.1)continue
  const targetCoordinate=[extent[0]+(x+.5)/canvas.width*(extent[2]-extent[0]),extent[3]-(y+.5)/canvas.height*(extent[3]-extent[1])]
  const sourceCoordinate=transform(targetCoordinate,target,src)
  const bandSource=sourceTiles.find(tile=>sourceCoordinate[0]>=tile.extent[0]&&sourceCoordinate[0]<tile.extent[2]&&sourceCoordinate[1]>=tile.extent[1]&&sourceCoordinate[1]<tile.extent[3])
  if(!bandSource){unreadable++;continue}
  const expected=Math.max(bandSource.minimumZoom,Math.min(bandSource.maximumZoom,reference-Math.floor(q))),index=(y*canvas.width+x)*4,rgb=[pixels[index],pixels[index+1],pixels[index+2]]
  if(pixels[index+3]===0){unreadable++;continue}
  let actual=-1,error=Infinity
  for(let z=0;z<colors.length;z++){const diff=colors[z].reduce((sum,value,i)=>sum+(value-rgb[i])**2,0);if(diff<error){error=diff;actual=z}}
  if(error>100){unreadable++;continue}
  checked++;if(actual!==expected){wrong++;const key=`${expected}→${actual}`;transitions[key]=(transitions[key]||0)+1;bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);if(examples.length<1){const sx=(sourceCoordinate[0]-bandSource.extent[0])/(bandSource.extent[2]-bandSource.extent[0])*256,sy=(bandSource.extent[3]-sourceCoordinate[1])/(bandSource.extent[3]-bandSource.extent[1])*256,mask=bandSource.spans,maskRows=[];if(ArrayBuffer.isView(mask))for(let i=0;i<mask.length;i+=4)if(mask[i+1]===Math.floor(sy))maskRows.push([mask[i],mask[i+2],mask[i+3]]);examples.push({pixel:[x,y],expected,actual,distortion:+q.toFixed(3),sourceCoord:sourceCoordinate.map(v=>+v.toFixed(1)),sourcePixel:[+sx.toFixed(2),+sy.toFixed(2)],sourceExtent:bandSource.extent,anchor:bandSource.anchor,sourcePlan:[bandSource.minimumZoom,bandSource.maximumZoom],reference:bandSource.reference,rawSpans:ArrayBuffer.isView(mask)?Array.from(mask):mask.slice(0,2),maskLength:mask?.length,maskRows})}}
 }
 results.push({coord,sourceZoom:tile.sourceZ_,reference,checked,wrong,unreadable,wrongBounds:wrong?bounds:null,transitions,examples});tile.release()
}
console.log(JSON.stringify(results,null,2))
if(results.some(r=>r.checked<100||r.wrong)){console.error('FAIL: reprojected zoom colors disagree with the distortion bands');process.exitCode=1}
