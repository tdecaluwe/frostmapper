import proj4 from 'proj4'
import {registerPeirce} from '../src/map/projections/peirce.js'
registerPeirce(proj4)
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
document.querySelector('#results').textContent=errors.length?errors.join('\n'):`Passed ${samples.length} PROJ reference cases and inverse checks`
if(errors.length)throw Error(errors.join('\n'))
