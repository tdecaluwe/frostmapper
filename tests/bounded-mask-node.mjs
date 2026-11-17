import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {ContourAtlasIndex} from '../src/map/reprojection/contour-atlas-index.js'
import {BandMaskPlanner} from '../src/map/reprojection/band-mask.js'
import {griegerField} from './grieger-field.mjs'
const file=process.argv[2]
if(!file)throw Error('Usage: node tests/bounded-mask-node.mjs atlas.json [report.json]')
const data=JSON.parse(await readFile(file)),index=new ContourAtlasIndex(data),planner=new BandMaskPlanner(),results=[]
for(const u of [.25,.5,0])for(const zoom of [6,10,16,20]){
 const v=u===.25?.5:u===.5?.3597250369152:.6402749630848,span=2**-zoom,left=Math.max(0,u-span*.3),bottom=v-span*.3,extent=[left,bottom,left+span,bottom+span]
 const anchor=griegerField([left+span/2,bottom+span/2]),spans=planner.plan(index,extent,64,64,anchor)
 let checked=0,wrong=0
 if(spans)for(let y=0;y<64;y+=3)for(let x=0;x<64;x+=3){
  const q=griegerField([left+(x+.5)*span/64,bottom+(63.5-y)*span/64])*data.steps
  if(Math.abs(q-Math.round(q))<.2)continue
  const s=spans.find(s=>s.y===y&&s.x<=x&&s.x+s.width>x)
  if(s){checked++;if(s.band!==Math.floor(q))wrong++}
 }
 results.push({u,zoom,checked,wrong,failed:!spans})
}
assert.ok(results.every(r=>r.checked>100&&!r.wrong&&!r.failed),'High-zoom band disagreement')
console.log(JSON.stringify(results,null,2))
if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(results,null,2))
