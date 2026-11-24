// Native model extent from NVE's seNorgeGrid/sd ImageServer metadata.
export const SNOW_EXTENT=[-75000,6450000,1120000,8000000]
export const CELL_SIZE=1000
export const cellKey=(x,y)=>`${Math.floor(x/CELL_SIZE)}/${Math.floor(y/CELL_SIZE)}`
export function visibleSnowCells(extent,maximum=4096){
 const [a,b,c,d]=extent
 if(![a,b,c,d].every(Number.isFinite)||a>=c||b>=d)return {cells:[],extent:null,count:0}
 const left=Math.max(SNOW_EXTENT[0],Math.floor(a/1000)*1000),bottom=Math.max(SNOW_EXTENT[1],Math.floor(b/1000)*1000),right=Math.min(SNOW_EXTENT[2],Math.ceil(c/1000)*1000),top=Math.min(SNOW_EXTENT[3],Math.ceil(d/1000)*1000)
 if(left>=right||bottom>=top)return {cells:[],extent:null,count:0}
 const count=(right-left)/1000*(top-bottom)/1000,result={extent:[left,bottom,right,top],count,cells:[]}
 if(count>maximum)return {...result,tooWide:true}
 const cx=(a+c)/2,cy=(b+d)/2
 for(let y=bottom+500;y<top;y+=1000)for(let x=left+500;x<right;x+=1000)result.cells.push({key:cellKey(x,y),x,y})
 result.cells.sort((u,v)=>(u.x-cx)**2+(u.y-cy)**2-((v.x-cx)**2+(v.y-cy)**2))
 return result
}
export function compactSnowEstimate(result,input){
 return {status:result.status,start:result.period?.start??null,end:result.period?.end??null,days:result.period?.averageDays??(result.lengthDays?.maximum===0?0:null),lengthBounds:result.lengthDays??null,wholeYears:result.wholePeriodYears??null,unknownDays:result.unknownDays,recoveredDays:input.quality.sweRecoveredDates.length,altitude:input.source.altitudeM}
}
const reference=Date.UTC(2001,8,1)
export function seasonalDay(md){return md?(Date.parse(`${Number(md.slice(0,2))>=9?2001:2002}-${md}T00:00:00Z`)-reference)/86400000:null}
const STOPS=[[255,255,204],[161,218,180],[65,182,196],[44,127,184],[37,52,148]]
export function snowColor(record,metric='length'){
 let value=metric==='start'?seasonalDay(record.start):metric==='end'?seasonalDay(record.end):record.days
 if(value===null||!Number.isFinite(value))return null
 let t=Math.max(0,Math.min(1,value/365));if(metric==='start')t=1-t
 const p=t*(STOPS.length-1),i=Math.min(STOPS.length-2,Math.floor(p)),f=p-i
 return STOPS[i].map((v,j)=>Math.round(v+(STOPS[i+1][j]-v)*f))
}
export function cachedSnowExtent(records){
 if(!records.size)return null
 let left=Infinity,bottom=Infinity,right=-Infinity,top=-Infinity
 for(const key of records.keys()){
  const [x,y]=key.split('/').map(Number);left=Math.min(left,x*1000);right=Math.max(right,(x+1)*1000);bottom=Math.min(bottom,y*1000);top=Math.max(top,(y+1)*1000)
 }
 return [left,bottom,right,top]
}
