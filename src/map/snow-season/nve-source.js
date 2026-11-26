const DAY=86400000,UNKNOWN=255
export const NVE_GTS_URL='https://gts.nve.no/api/GridTimeSeries'
function apiStart(value){
 const match=/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value)
 if(!match)throw new Error('Unrecognized NVE date')
 return `${match[3]}-${match[2]}-${match[1]}`
}
const dayNumber=value=>Date.parse(`${value}T00:00:00Z`)/DAY
const dateLabel=day=>new Date(day*DAY).toISOString().slice(0,10)
function valid(value,noData){return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value!==noData}
/** Convert raw millimetres without rounding snow depth to human-readable cm. */
export function snowPresence(depth,{minimumDepthMm=0,swe=null}={}){
 if(!Number.isFinite(minimumDepthMm)||minimumDepthMm<0)throw new RangeError('Invalid depth threshold')
 if(depth.TimeResolution!==1440||depth.Unit!=='mm'||!Array.isArray(depth.Data))throw new Error('Expected daily raw snow depth in mm')
 const startDate=apiStart(depth.StartDate),first=dayNumber(startDate)
 if(dayNumber(apiStart(depth.EndDate))-first+1!==depth.Data.length)throw new Error('NVE date range/data length mismatch')
 if(swe&&(swe.TimeResolution!==1440||swe.Unit!=='mm'||swe.X!==depth.X||swe.Y!==depth.Y))throw new Error('SWE must describe the same daily grid point')
 const sweFirst=swe?dayNumber(apiStart(swe.StartDate)):0,cover=new Uint8Array(depth.Data.length),recoveredDates=[],unknownDates=[],missingDepthDates=[]
 for(let i=0;i<cover.length;i++){
  const v=depth.Data[i]
  if(valid(v,depth.NoDataValue)){cover[i]=v>minimumDepthMm?1:0;continue}
  const date=dateLabel(first+i);missingDepthDates.push(date)
  const water=swe?.Data[first+i-sweFirst]
  // Positive SWE proves presence only. Zero SWE may reflect rounding, and it
  // cannot establish a minimum snow depth greater than zero.
  if(minimumDepthMm===0&&swe&&valid(water,swe.NoDataValue)&&water>0){cover[i]=1;recoveredDates.push(date)}
  else {cover[i]=UNKNOWN;unknownDates.push(date)}
 }
 return {startDate,cover,quality:{minimumDepthMm,missingDepthDates,sweRecoveredDates:recoveredDates,unknownDates}}
}
/** Offline/worker fetch adapter. Public GTS currently lacks browser CORS;
 * export its small summaries to static files for the deployed map.
 */
export class NveSnowDepthSource{
 constructor({fetchImpl=(...args)=>globalThis.fetch(...args),baseUrl=NVE_GTS_URL}={}){this.fetch=fetchImpl;this.baseUrl=baseUrl.replace(/\/$/,'')}
 async series({x,y,startDate,endDate,theme='sd'}){
  if(!Number.isFinite(x)||!Number.isFinite(y)||!['sd','swe'].includes(theme))throw new TypeError('Invalid source query')
  if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||startDate>endDate)throw new TypeError('Invalid date range')
  const url=`${this.baseUrl}/raw/${Math.round(x)}/${Math.round(y)}/${startDate}/${endDate}/${theme}.json`
  const response=await this.fetch(url,{signal:AbortSignal.timeout(60000)})
  if(!response.ok)throw new Error(`NVE ${theme}: HTTP ${response.status}`)
  const data=await response.json()
  if(data.Theme!==theme)throw new Error('Unexpected NVE theme')
  return {data,url}
 }
 async load({x,y,startDate,endDate,minimumDepthMm=0}){
  const depth=await this.series({x,y,startDate,endDate}),initial=snowPresence(depth.data,{minimumDepthMm}),sources=[depth.url]
  let swe=null,supplementError=null
  if(minimumDepthMm===0&&initial.quality.unknownDates.length&&initial.quality.unknownDates.length<=8){
   const dates=initial.quality.unknownDates
   try{
    const extra=await this.series({x,y,startDate:dates[0],endDate:dates.at(-1),theme:'swe'})
    swe=extra.data;sources.push(extra.url)
   }catch(error){if(error.name==='AbortError')throw error;supplementError=String(error.message||error)}
  }
  return {...snowPresence(depth.data,{minimumDepthMm,swe}),source:{name:'NVE seNorge sd',projection:'EPSG:32633',x:depth.data.X,y:depth.data.Y,altitudeM:depth.data.Altitude,nativeResolutionM:1000,urls:sources,retrievedAt:new Date().toISOString(),supplementError,snowPresenceEvidence:swe?'sd, positive swe on missing depth dates':'sd'}}
 }
}

export const NVE_BROWSER_URL='https://services.xgeo.no/seNorgeMapAppServices/Services/UIService.svc/GetMapGridInfo'
/** The CORS-enabled endpoint used by seNorge's own map. Normalize units and
 * preserve missing values before converting centimetres to millimetres. */
export function browserSeries(data,{x,y,startDate,endDate,theme}){
 if(data.ErrorMessage){
  const error=new Error(/\(400\) Bad Request/.test(data.ErrorMessage)?'Outside seNorge model coverage':'NVE could not return daily snow data');error.noCell=/\(400\) Bad Request/.test(data.ErrorMessage);throw error
 }
 if(data.Theme!==theme||data.TimeResolution!==1440||!Array.isArray(data.MapGridValue))throw new Error('Invalid seNorge daily series')
 const expected=dayNumber(endDate)-dayNumber(startDate)+1
 if(data.MapGridValue.length!==expected)throw new Error('Incomplete seNorge history')
 const scale=data.Unit==='mm'?1:data.Unit==='cm'?10:null
 if(scale===null)throw new Error('Unknown seNorge depth units')
 const apiDate=iso=>`${iso.slice(8,10)}.${iso.slice(5,7)}.${iso.slice(0,4)} 06:00:00`
 return {Theme:theme,X:x,Y:y,Altitude:data.MASL,Unit:'mm',TimeResolution:1440,NoDataValue:null,StartDate:apiDate(startDate),EndDate:apiDate(endDate),Data:data.MapGridValue.map(v=>valid(v,data.NoDataValue)?v*scale:null)}
}
export class NveBrowserSnowDepthSource extends NveSnowDepthSource{
 constructor({fetchImpl=(...args)=>globalThis.fetch(...args),endpoint=NVE_BROWSER_URL}={}){super({fetchImpl});this.endpoint=endpoint}
 async series({x,y,startDate,endDate,theme='sd'}){
  if(!Number.isFinite(x)||!Number.isFinite(y)||!['sd','swe'].includes(theme))throw new TypeError('Invalid source query')
  if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||startDate>endDate)throw new TypeError('Invalid date range')
  x=Math.round(x);y=Math.round(y)
  const request={x,y,id:theme,startDateTime:startDate,endDateTime:endDate}
  const url=`${this.endpoint}?request=${encodeURIComponent(JSON.stringify(request))}`
  const response=await this.fetch(url,{signal:AbortSignal.timeout(60000),cache:'no-store'})
  if(!response.ok)throw new Error(`NVE ${theme}: HTTP ${response.status}`)
  return {data:browserSeries(await response.json(),{x,y,startDate,endDate,theme}),url}
 }
}
