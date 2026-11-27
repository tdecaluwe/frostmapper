import {NestedIntervalCodec} from './interval-codec.js?v=snow-depth-v3'
import {depthIndex} from './depths.js?v=snow-depth-v3'
const DAY=86400000,REFERENCE=Date.UTC(2001,8,1)
export const seasonStart=year=>Date.UTC(year-1,8,1)
export const seasonDays=year=>(Date.UTC(year,8,1)-seasonStart(year))/DAY
const codecs=new Map()
export function yearCodec(year){
 const boundaries=seasonDays(year)+1
 if(!codecs.has(boundaries)){
  const codec=new NestedIntervalCodec(5,boundaries)
  if(codec.bitLength!==64)throw new Error('Annual snow intervals must occupy exactly eight bytes')
  codecs.set(boundaries,codec)
 }
 return codecs.get(boundaries)
}
function longest(bands,offset,first,last,level,possible){
 let start=first,end=first,begin=-1
 for(let d=first;d<=last;d++){
  const v=bands[offset+d]??7,snow=d<last&&(v===7?possible:v===6?(level===0||possible):v>level)
  if(snow&&begin<0)begin=d
  if(!snow&&begin>=0){if(d-begin>end-start){start=begin;end=d}begin=-1}
 }
 return [start,end]
}
/** Main positive-snow season, then longest deeper runs within its parent.
 * Unknown days are tested both bare and covered. Matching winners establish an
 * exact interval for every intermediate assignment, including the tie rule.
 */
export function estimateAnnualSeasons({startDate,bands},cohort){
 if(!(bands instanceof Uint8Array))throw new TypeError('Expected depth bands')
 const source=Date.parse(`${startDate}T00:00:00Z`),years=cohort.years
 const data=new Uint8Array(years*8),known=new Uint8Array(years)
 for(let y=0;y<years;y++){
  const year=cohort.firstEndYear+y,offset=(seasonStart(year)-source)/DAY
  let parent=[0,seasonDays(year)],certain=0
  const intervals=[]
  for(let level=0;level<5;level++){
   if(certain!==level){intervals.push([parent[0],parent[0]]);continue}
   const lower=longest(bands,offset,...parent,level,false),upper=longest(bands,offset,...parent,level,true)
   if(lower[0]!==upper[0]||lower[1]!==upper[1]){intervals.push([parent[0],parent[0]]);continue}
   parent=lower;intervals.push(parent);certain++
  }
  data.set(yearCodec(year).encode(intervals),y*8);known[y]=certain
 }
 return {data,known}
}
const md=index=>index>=0&&index<365?new Date(REFERENCE+index*DAY).toISOString().slice(5,10):null
function calendar(ms,start){
 const d=new Date(ms),m=d.getUTCMonth(),day=d.getUTCDate()
 if(m===1&&day===29)return start?181:180 // March 1 / February 28.
 return (Date.UTC(m>=8?2001:2002,m,day)-REFERENCE)/DAY
}
function actual(index,year){const d=new Date(REFERENCE+index*DAY),m=d.getUTCMonth();return Date.UTC(m>=8?year-1:year,m,d.getUTCDate())}
/** Independent 95% endpoint quantiles, derived entirely from annual words. */
export function summarizeAnnualSeasons({data,known},cohort,minimumDepth=0){
 const level=depthIndex(minimumDepth),runs=[],starts=[],ends=[]
 let unknownYears=0
 for(let y=0;y<cohort.years;y++){
  if(known[y]<=level){unknownYears++;runs.push(null);continue}
  const year=cohort.firstEndYear+y,[s,e]=yearCodec(year).decode(data.subarray(y*8,y*8+8))[level]
  const run=s===e?{s:365,e:-1}: {s:calendar(seasonStart(year)+s*DAY,true),e:calendar(seasonStart(year)+(e-1)*DAY,false)}
  runs.push(run);starts.push(run.s);ends.push(run.e)
 }
 const required=Math.ceil(.95*cohort.years-1e-12),quantile=(a,fill,index)=>a.concat(Array(unknownYears).fill(fill)).sort((a,b)=>a-b)[index]
 const startLo=quantile(starts,0,required-1),startHi=quantile(starts,365,required-1)
 const endLo=quantile(ends,-1,cohort.years-required),endHi=quantile(ends,364,cohort.years-required)
 const lengthBounds={minimum:Math.max(0,endLo-startHi+1),maximum:Math.max(0,endHi-startLo+1)}
 const common={status:unknownYears?'bounded':'complete',minimumDepth,unknownYears,lengthBounds,start:null,end:null,days:null,wholeYears:null}
 if(!lengthBounds.maximum)return {...common,days:0}
 if(startLo!==startHi||endLo!==endHi)return common
 let total=0,whole=0
 for(let y=0;y<cohort.years;y++){
  const year=cohort.firstEndYear+y
  total+=(actual(endLo,year)-actual(startLo,year))/DAY+1
  if(runs[y]&&runs[y].s<=startLo&&runs[y].e>=endLo)whole++
 }
 return {...common,start:md(startLo),end:md(endLo),days:total/cohort.years,wholeYears:{minimum:whole,maximum:whole+unknownYears}}
}
