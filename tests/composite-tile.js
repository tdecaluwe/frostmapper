import Tile from 'ol/Tile.js'
import TileState from 'ol/TileState.js'
import {CompositeTile} from '../src/map/reprojection/composite-tile.js'
class FakeTile extends Tile{
 constructor(color,state=TileState.IDLE){super([0,0,0],state);this.canvas=document.createElement('canvas');this.canvas.width=4;this.canvas.height=2;const c=this.canvas.getContext('2d');c.fillStyle=color;c.fillRect(0,0,4,2)}
 getImage(){return this.canvas}
 load(){this.state=TileState.LOADED;this.changed()}
}
const errors=[],red=new FakeTile('red'),blue=new FakeTile('blue')
const tile=new CompositeTile([0,0,0],new Map([[2,red],[3,blue]]),[{x:0,y:0,width:2,zoom:2},{x:0,y:1,width:2,zoom:2},{x:2,y:0,width:2,zoom:3},{x:2,y:1,width:2,zoom:3}],4,2,{})
tile.load()
if(tile.getState()!==TileState.LOADED)errors.push('composite did not load')
const pixels=tile.getImage().getContext('2d').getImageData(0,0,4,2).data
for(let y=0;y<2;y++)for(let x=0;x<4;x++){const i=(y*4+x)*4;if(pixels[i+3]!==255||pixels[i+(x<2?0:2)]!==255)errors.push(`incorrect pixel ${x},${y}`)}
if(red.getState()!==TileState.EMPTY||blue.getState()!==TileState.EMPTY)errors.push('intermediate tiles were not released')
const failed=new CompositeTile([0,0,0],new Map([[1,new FakeTile('red',TileState.ERROR)]]),[],4,2,{})
failed.load();if(failed.getState()!==TileState.ERROR)errors.push('failed child must fail composite')
tile.release();if(tile.getState()!==TileState.EMPTY)errors.push('composite release')
document.querySelector('#results').textContent=errors.length?errors.join('\n'):'Passed composite tile checks'
if(errors.length)throw Error(errors.join('\n'))
