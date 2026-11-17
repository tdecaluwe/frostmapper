// Grieger benchmark diagnostic: compare full reference coverage to the subset
// visible under the candidate's scale/pixel policy. Not used in construction.
import {readFile} from 'node:fs/promises'
import {ContourVisibility} from '../src/map/reprojection/contour-visibility.js'
import {bezier} from '../src/map/reprojection/bounded-contours.js'
import {project} from './grieger-projection-field.mjs'
import {HORIZONTAL_HALF_HEIGHT as K} from '../src/map/projections/peirce-horizontal.js'
const [referenceFile,candidateFile]=process.argv.slice(2)
if(!referenceFile||!candidateFile)throw Error('Usage: node tests/compare-visible-coverage-node.mjs reference-atlas.json candidate-atlas.json')
const reference=JSON.parse(await readFile(referenceFile)),candidate=JSON.parse(await readFile(candidateFile)),W=2*Math.PI*6378137,TW=4*K*6378137
const visibility=new ContourVisibility({minPatchPixels:candidate.quality.minPatchPixels,highestZoom:candidate.quality.visibilityHighestZoom??20,zoomOffset:candidate.quality.visibilityZoomOffset??0,project:([u,v])=>project((u-.5)*W,(v-.5)*W),worldWidth:TW,resolutionAtZoom:z=>TW/256/2**z})
function* points(path){for(const c of path.curves)for(let j=0;j<=32;j++)yield bezier(c,j/32)}
function bounds(path){let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;for(const [x,y] of points(path)){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}return {x:(x0+x1)/2,y:(y0+y1)/2,d:Math.hypot(x1-x0,y1-y0)}}
const wanted=reference.paths.filter(p=>p.step/reference.steps>=candidate.quality.minScale&&p.step<=candidate.maxStep&&visibility.visible(points(p),p.step/reference.steps)).map(p=>({path:p,bounds:bounds(p)})),used=new Set()
let matched=0
for(const p of candidate.paths){const a=bounds(p);for(let i=0;i<wanted.length;i++){
 const {path:q,bounds:b}=wanted[i]
 if(used.has(i)||p.step!==q.step||p.closed!==q.closed)continue
 const dx=a.x-b.x-Math.round(a.x-b.x),dy=a.y-b.y
 if(a.d/b.d>.5&&a.d/b.d<2&&Math.hypot(dx,dy)<Math.max(a.d,b.d)*.5){used.add(i);matched++;break}
}}
console.log(JSON.stringify({reference:reference.paths.length,required:wanted.length,retained:candidate.paths.length,matched,missing:wanted.length-matched,unmatched:candidate.paths.length-matched,minScale:candidate.quality.minScale,minPatchPixels:candidate.quality.minPatchPixels}))
if(matched!==wanted.length||matched!==candidate.paths.length)process.exitCode=1
