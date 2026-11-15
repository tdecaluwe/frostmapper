import '../src/map/projections/index.js?v=grieger-wrap'
import {get} from 'ol/proj.js'
import {projectionDistortion,DistortionField} from '../src/map/reprojection/distortion.js'
import {ContourAtlas} from '../src/map/reprojection/contour-atlas.js'
import {BandMaskPlanner} from '../src/map/reprojection/band-mask.js'
const src=get('EPSG:3857'),result={}
for(const [code,file] of [['EPSG:3035','epsg-3035'],['EPSG:PEIRCE','epsg-peirce'],['FROST:TRIPTYCHIAL','frost-triptychial']]){
 const p=get(code),[x0,y0,x1,y1]=p.getExtent(),atlas=new ContourAtlas(await(await fetch(`../data/contours/${file}.json`)).json()),planner=new BandMaskPlanner(),width=32,height=32
 let checked=0,bad=0,fall=0,invalid=0
 for(let iy=0;iy<8;iy++)for(let ix=0;ix<8;ix++)for(let phase=0;phase<4;phase++){
  const left=x0+(x1-x0)*ix/8,right=x0+(x1-x0)*(ix+1)/8,bottom=y0+(y1-y0)*iy/8,top=y0+(y1-y0)*(iy+1)/8,extent=[left,bottom,right,top],anchor=projectionDistortion(p,src,[(left+right)/2,(bottom+top)/2])
  if(anchor===null){invalid++;continue}const spans=planner.plan(atlas,extent,phase,width,height,anchor);if(!spans||!planner.validate(spans,extent,phase,width,height,new DistortionField(p,src),{samples:9})){fall++;continue}
  for(let y=1;y<32;y+=4)for(let x=1;x<32;x+=4){const v=projectionDistortion(p,src,[left+(x+.5)/width*(right-left),top-(y+.5)/height*(top-bottom)]);if(v===null)continue;const expected=Math.floor(v+phase/4),span=spans.find(s=>s.y===y&&s.x<=x&&s.x+s.width>x);if(!span)throw Error('missing span');const delta=Math.abs((v+phase/4)-Math.round(v+phase/4));if(delta>.13){checked++;if(span.band!==expected)bad++}}
 }
 result[code]={checked,bad,fall,invalid}
}
const failures=Object.entries(result).filter(([,stats])=>stats.bad>0||stats.checked<1000)
document.querySelector('#results').textContent=(failures.length?'Failed':'Passed')+' sampled band mask checks\n'+JSON.stringify(result,null,2)
if(failures.length)throw Error('Band masks disagree with sampled distortion')
