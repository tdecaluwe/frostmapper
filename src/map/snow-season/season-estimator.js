const DAY=86400000,UNKNOWN=255,REFERENCE_START=Date.UTC(2001,8,1)
function dateMs(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new TypeError('Expected an ISO calendar date')
 const ms=Date.parse(`${value}T00:00:00Z`)
 if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==value)throw new RangeError('Invalid calendar date')
 return ms
}
const iso=ms=>new Date(ms).toISOString().slice(0,10)
// A fixed calendar period, rather than leap-year-dependent day-of-year ranks.
function calendarIndex(ms,isStart){
 const d=new Date(ms),month=d.getUTCMonth(),day=d.getUTCDate()
 if(month===1&&day===29)return (Date.UTC(2002,2,1)-REFERENCE_START)/DAY-(isStart?0:1)
 return (Date.UTC(month>=8?2001:2002,month,day)-REFERENCE_START)/DAY
}
const monthDay=index=>index>=0&&index<365?iso(REFERENCE_START+index*DAY).slice(5):null
function actualDate(index,endYear){
 const d=new Date(REFERENCE_START+index*DAY),month=d.getUTCMonth()
 return Date.UTC(month>=8?endYear-1:endYear,month,d.getUTCDate())
}
function mainRun(days,base,first,last,unknownBits,unknownIndexes){
 let bestStart=-1,bestEnd=-1,begin=-1
 for(let day=first;day<=last;day++){
  const index=day-base,value=days[index]
  const snow=day<last&&(value===1||(value===UNKNOWN&&((unknownBits>>unknownIndexes.get(index))&1)===1))
  if(snow&&begin<0)begin=day
  if(!snow&&begin>=0){
   // Equal-length runs use the earlier run, consistently across all scenarios.
   if(bestStart<0||day-begin>bestEnd-bestStart+1){bestStart=begin;bestEnd=day-1}
   begin=-1
  }
 }
 return bestStart<0?{start:365,end:-1,days:0}:{start:calendarIndex(bestStart*DAY,true),end:calendarIndex(bestEnd*DAY,false),days:bestEnd-bestStart+1}
}
/** Independent empirical onset/melt quantiles of each year's longest snow run.
 * Input is daily snow presence: 0=bare, 1=snow, 255=unknown. Missing days are
 * enumerated, never imputed. Uncertainty bounds cover every allowed assignment.
 */
export class SnowSeasonEstimator{
 constructor({referenceYear=new Date().getUTCFullYear(),years=20,confidence=.95,maxUnknownDays=8}={}){
  if(!Number.isInteger(referenceYear)||referenceYear<1901||referenceYear>9998||!Number.isInteger(years)||years<1||years>=referenceYear-1)throw new RangeError('Invalid cohort')
  if(!(confidence>0&&confidence<=1)||!Number.isInteger(maxUnknownDays)||maxUnknownDays<0||maxUnknownDays>16)throw new RangeError('Invalid confidence or missing-data limit')
  Object.assign(this,{referenceYear,years,confidence,maxUnknownDays})
 }
 get cohort(){
  const lastEndYear=this.referenceYear-1,firstEndYear=lastEndYear-this.years+1
  return {firstEndYear,lastEndYear,startDate:`${firstEndYear-1}-09-01`,endDate:`${lastEndYear}-08-31`,years:this.years}
 }
 estimate({startDate,cover}){
  const cohort=this.cohort,first=dateMs(cohort.startDate)/DAY,last=dateMs(cohort.endDate)/DAY+1,sourceFirst=dateMs(startDate)/DAY
  const days=new Uint8Array(last-first),unknownIndexes=new Map()
  for(let day=first;day<last;day++){
   const value=cover[day-sourceFirst]
   if(value!==undefined&&value!==0&&value!==1&&value!==UNKNOWN)throw new TypeError('Invalid snow-presence value')
   days[day-first]=value??UNKNOWN
   if(days[day-first]===UNKNOWN)unknownIndexes.set(day-first,unknownIndexes.size)
  }
  const common={cohort,confidence:this.confidence,requiredYears:Math.max(1,Math.ceil(this.confidence*this.years-1e-12)),unknownDays:unknownIndexes.size,definition:'Independent onset and melt quantiles of the longest uninterrupted positive-snow run in each September–August season',calendar:'365-day month/day reference; Feb 29 onset rounds forward, melt rounds backward; average duration includes leap days'}
  if(unknownIndexes.size>this.maxUnknownDays)return {...common,status:'insufficient-data',reason:'Too many unresolved days to bound exactly',period:null}
  const scenarios=2**unknownIndexes.size,starts=[],ends=[],lengths=[],means=[],whole=[],annual=[]
  for(let bits=0;bits<scenarios;bits++){
   const runs=[]
   for(let year=cohort.firstEndYear;year<=cohort.lastEndYear;year++){
    const a=Date.UTC(year-1,8,1)/DAY,b=Date.UTC(year,8,1)/DAY
    runs.push({endYear:year,...mainRun(days,first,a,b,bits,unknownIndexes)})
   }
   const start=runs.map(r=>r.start).sort((a,b)=>a-b)[common.requiredYears-1]
   const end=runs.map(r=>r.end).sort((a,b)=>a-b)[this.years-common.requiredYears]
   const length=Math.max(0,end-start+1)
   let success=0,mean=0
   if(length>0)for(const run of runs){
    const a=actualDate(start,run.endYear)/DAY,b=actualDate(end,run.endYear)/DAY
    mean+=b-a+1
    let good=true
    for(let day=a;day<=b;day++){
     const i=day-first,v=days[i]
     if(v===0||(v===UNKNOWN&&((bits>>unknownIndexes.get(i))&1)===0)){good=false;break}
    }
    success+=good?1:0
   }
   starts.push(start);ends.push(end);lengths.push(length);means.push(mean/this.years);whole.push(success)
   if(bits===0)annual.push(...runs)
  }
  const range=values=>({minimum:Math.min(...values),maximum:Math.max(...values)})
  const onset=range(starts),melt=range(ends),length=range(lengths),averageLength=range(means)
  const invariant=onset.minimum===onset.maximum&&melt.minimum===melt.maximum
  return {...common,status:unknownIndexes.size?'bounded':'complete',scenarios,
   onset:{earliest:monthDay(onset.minimum),latest:monthDay(onset.maximum)},
   melt:{earliest:monthDay(melt.minimum),latest:monthDay(melt.maximum)},
   lengthDays:length,averageLengthDays:averageLength,
   period:invariant&&length.minimum>0?{start:monthDay(onset.minimum),end:monthDay(melt.minimum),nominalDays:length.minimum,averageDays:averageLength.minimum}:null,
   wholePeriodYears:range(whole),annual:unknownIndexes.size?null:annual.map(r=>({endYear:r.endYear,start:monthDay(r.start),end:monthDay(r.end),lengthDays:r.days}))}
 }
}
export {UNKNOWN as UNKNOWN_SNOW_COVER}
