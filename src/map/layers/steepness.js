import TileLayer from 'ol/layer/Tile.js'
import XYZ from 'ol/source/XYZ.js'
import TileState from 'ol/TileState.js'
import {ZoomBandSource} from '../reprojection/zoom-band-source.js?v=source-loads'
import {SLOPE_BANDS} from '../terrain/slope.js'

class SlopeTiles {
 constructor(onError){this.next=0;this.pending=new Map();this.onError=onError}
 load(tile){
  if(!this.worker){
   try{
    this.worker=new Worker(new URL('../terrain/slope-worker.js',import.meta.url),{type:'module'})
    this.worker.onmessage=({data})=>{
     const tile=this.pending.get(data.id);this.pending.delete(data.id)
     if(!tile)return
     if(data.error){tile.setState(TileState.ERROR);this.onError(data.error);return}
     const image=tile.getImage(),url=URL.createObjectURL(data.blob)
     const clean=()=>{URL.revokeObjectURL(url);image.removeEventListener('load',clean);image.removeEventListener('error',clean)}
     image.addEventListener('load',clean);image.addEventListener('error',clean);image.src=url
    }
    this.worker.onerror=()=>{
     for(const tile of this.pending.values())tile.setState(TileState.ERROR)
     this.pending.clear();this.worker.terminate();this.worker=null
     this.onError('Terrain worker unavailable')
    }
   }catch(error){tile.setState(TileState.ERROR);this.onError(error.message);return}
  }
  const [z,x,y]=tile.getTileCoord(),id=++this.next
  this.pending.set(id,tile);this.worker.postMessage({id,z,x,y})
 }
}

export function addSteepnessLayer(map,contourReprojection){
 const container=document.createElement('div'),label=document.createElement('label'),toggle=document.createElement('input')
 toggle.type='checkbox';label.append(toggle,' Steepness');container.append(label)
 const legend=document.createElement('div');legend.className='slope-legend';legend.hidden=true
 for(const band of SLOPE_BANDS){
  const item=document.createElement('span'),swatch=document.createElement('i')
  swatch.style.backgroundColor=`rgb(${band.color.join(',')})`;item.append(swatch,band.label);legend.append(item)
 }
 const note=document.createElement('small');note.textContent='Terrain estimate · below 15° transparent';legend.append(note)
 const status=document.createElement('small');status.className='slope-status';status.setAttribute('role','status');legend.append(status)
 container.append(legend);document.querySelector('#layers').append(container)
 const tiles=new SlopeTiles(error=>{status.textContent=`Terrain unavailable: ${error}`})
 const source=new (ZoomBandSource(XYZ))({
  projection:'EPSG:3857',url:'slope://{z}/{x}/{y}',maxZoom:15,wrapX:true,transition:0,interpolate:false,
  tileLoadFunction:tile=>tiles.load(tile),
  attributions:'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen / AWS Terrain Tiles</a> · Norway: © Kartverket'
 })
 source.configureZoomBands(contourReprojection)
 const layer=new TileLayer({source,visible:false,opacity:.65,zIndex:10,preload:0,cacheSize:256})
 map.addLayer(layer)
 toggle.addEventListener('change',()=>{layer.setVisible(toggle.checked);legend.hidden=!toggle.checked})
 return layer
}
