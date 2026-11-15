import proj4 from 'proj4'
import {registerPeirce,registerAffine,registerPipeline,definePipeline} from '../src/map/projections/peirce.js'
import {registerOblique} from '../src/map/projections/ob-tran.js'
registerPeirce(proj4)
registerAffine(proj4)
registerOblique(proj4)
registerPipeline(proj4)
// Reference values from PROJ 9.8.1, default WGS84 radius, metres.
const definition='+proj=peirce_q +lon_0=25 +shape=horizontal'
const samples=[[[25,90],[-11825542.30005894,0]],[[25,45],[-11825542.30005894,-5268454.937608348]],[[115,45],[-6557087.362450594,0]],[[25,-45],[11825542.30005894,-5268454.937608348]],[[-65,-45],[17093997.23766729,0]],[[0,0],[-16051949.84518881,-11825542.552198235]],[[179,20],[-8090286.432280449,8150825.293098038]],[[-170,-65],[11094261.936652746,2731458.8361553224]]]
const errors=[]
for(const [coordinate,reference] of samples){
 const actual=proj4('WGS84',definition,coordinate)
 if(actual.some((v,i)=>Math.abs(v-reference[i])>0.02))errors.push(`forward ${coordinate}: ${actual}`)
 if(Math.abs(coordinate[1])!==90 && coordinate[1]!==0){const inverse=proj4(definition,'WGS84',actual);if(inverse.some((v,i)=>Math.abs(v-coordinate[i])>1e-6))errors.push(`inverse ${coordinate}: ${inverse}`)}
}
const zeroMeridian='+proj=peirce_q +lon_0=0 +shape=horizontal'
for(const lat of [-75,-30,0,30,75])for(const lon of [-140,-60,0,60,140]){
 const shifted=proj4('WGS84',definition,[lon+25,lat]),unshifted=proj4('WGS84',zeroMeridian,[lon,lat])
 if(shifted.some((v,i)=>Math.abs(v-unshifted[i])>0.001))errors.push(`central meridian ${lon},${lat}`)
}
try{proj4('WGS84','+proj=peirce_q +shape=bogus',[0,45]);errors.push('unsupported shape accepted')}catch{}
const pipeline='+proj=pipeline +step +proj=ob_tran +o_proj=peirce_q +o_lat_p=-45 +o_lon_p=45 +shape=horizontal +scrollx=-0.25 +step +proj=affine +s11=-1 +s12=0 +s21=0 +s22=-1'
definePipeline(proj4,'TEST:PIPELINE',pipeline)
const pipelineSamples=[[[0,0],[-3747362.0663248566,-3747362.0663248575]],[[10,50],[932612.7799023766,-79612.15236828041]],[[-75,40],[-2368036.331802733,5976229.425756184]],[[140,-30],[20320697.590765838,-2182129.0714387535]]]
for(const [coordinate,reference] of pipelineSamples){
 const actual=proj4('WGS84','TEST:PIPELINE',coordinate)
 if(actual.some((v,i)=>Math.abs(v-reference[i])>0.05))errors.push(`pipeline forward ${coordinate}: ${actual}`)
 const inverse=proj4('TEST:PIPELINE','WGS84',actual)
 if(inverse.some((v,i)=>Math.abs(v-coordinate[i])>1e-6))errors.push(`pipeline inverse ${coordinate}: ${inverse}`)
}
const originalPipeline='+proj=pipeline +step +proj=ob_tran +o_proj=peirce_q +o_lat_p=-45 +o_lon_p=45 +o_type=horizontal +o_scrollx=-0.25 +step +proj=affine +s11=-1 +s12=0 +s21=0 +s22=-1'
definePipeline(proj4,'TEST:PROJ_LITERAL',originalPipeline)
for(const [coordinate,reference] of pipelineSamples){const actual=proj4('WGS84','TEST:PROJ_LITERAL',coordinate);if(actual.some((v,i)=>Math.abs(v-reference[i])>0.05))errors.push(`documented pipeline ${coordinate}: ${actual}`);const inverse=proj4('TEST:PROJ_LITERAL','WGS84',actual);if(inverse.some((v,i)=>Math.abs(v-coordinate[i])>1e-6))errors.push(`documented inverse ${coordinate}: ${inverse}`)}
document.querySelector('#results').textContent=errors.length?errors.join('\n'):`Passed ${samples.length} Peirce and ${pipelineSamples.length * 2} pipeline reference cases and inverse checks`
if(errors.length)throw Error(errors.join('\n'))
