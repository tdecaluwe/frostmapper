import Tile from 'ol/Tile.js'
import TileState from 'ol/TileState.js'
import {createXYZ} from 'ol/tilegrid.js'
import {AssembledZoomTile} from '../src/map/reprojection/source-assembler.js?v=source-loads'
class ColorTile extends Tile{
 constructor(color){super([0,0,0],TileState.IDLE);this.canvas=document.createElement('canvas');this.canvas.width=this.canvas.height=256;const ctx=this.canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,256,256)}
 getImage(){return this.canvas}
 load(){this.state=TileState.LOADED;this.changed()}
}
const grid=createXYZ({maxZoom:4}),extent=grid.getTileCoordExtent([1,0,0]),parents=new Map(),colors=['red','lime','blue','yellow']
for(let y=0;y<2;y++)for(let x=0;x<2;x++){let id=y*2+x;parents.set(`2/${x}/${y}`,{zoom:2,coord:[2,x,y],tile:new ColorTile(colors[id])})}
const tile=new AssembledZoomTile([1,0,0],parents,[{x:0,y:0,width:256,height:256,zoom:2}],extent,grid,256,256,{})
tile.load()
const ctx=tile.getImage()?.getContext('2d'),expected=[[255,0,0],[0,255,0],[0,0,255],[255,255,0]],errors=[]
for(let y=0;y<2;y++)for(let x=0;x<2;x++){const pix=ctx?.getImageData(x*128+64,y*128+64,1,1).data,want=expected[y*2+x];if(!pix||want.some((v,i)=>pix[i]!==v))errors.push(`wrong child ${x},${y}`)}
{
 const fallback=new ColorTile('red'),failed=new ColorTile('blue')
 failed.load=function(){this.state=TileState.ERROR;this.changed()}
 const parents=new Map([['base',{zoom:1,coord:[1,0,0],tile:fallback}],['detail',{zoom:2,coord:[2,0,0],tile:failed}]])
 const mixed=new AssembledZoomTile([1,0,0],parents,[{x:0,y:0,width:128,height:128,zoom:2}],extent,grid,256,256,{})
 mixed.load()
 const pixel=mixed.getImage()?.getContext('2d').getImageData(32,32,1,1).data
 if(mixed.getState()!==TileState.LOADED||!pixel||pixel[0]!==255||pixel[3]!==255)errors.push('failed detail should retain coarse fallback')
}
{
 const failed=new ColorTile('blue');failed.load=function(){this.state=TileState.ERROR;this.changed()}
 const parents=new Map([['failed',{zoom:1,coord:[1,0,0],tile:failed}]])
 const mixed=new AssembledZoomTile([1,0,0],parents,[{x:0,y:0,width:256,height:256,zoom:1}],extent,grid,256,256,{},()=>({zoom:0,coord:[0,0,0],tile:new ColorTile('red')}))
 mixed.load()
 const pixel=mixed.getImage()?.getContext('2d').getImageData(32,32,1,1).data
 if(mixed.getState()!==TileState.LOADED||!pixel||pixel[0]!==255||pixel[3]!==255)errors.push('all failed source tiles should use the emergency ancestor')
}
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed higher-zoom child assembly'
if(errors.length)throw Error(errors.join('\n'))
