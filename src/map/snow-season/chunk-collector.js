import {estimateAnnualSeasons} from './annual-seasons.js?v=snow-serial-v6'
import {hasCell,setChunkYearCell,finishChunkCells} from './annual-chunk-codec.js?v=snow-serial-v6'
import {chunkCell} from './chunk-grid.js?v=snow-serial-v6'
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))
/** One annual history at a time. A region lock protects read/modify/save across
 * workers; the separate download lock is held only during each HTTP response. */
export class SnowChunkCollector{
 constructor({source,store,cohort,gate,onProcessing=()=>{}}){Object.assign(this,{source,store,cohort,gate,onProcessing})}
 async collect(area,{priority=()=>0}={}){
  const {cx,cy}=chunkCell(area.cells[0].key),{cohort,store,source}=this
  if(cohort.years>31)throw new RangeError('Annual checkpoints support up to 31 years')
  const allYears=2**cohort.years-1,region=`${store.namespace}/${cx}/${cy}`
  for(let y=0;y<cohort.years;y++){
   let done=false
   await this.gate.region(region,async()=>{
    const chunk=await store.reloadChunk(cx,cy),cells=area.cells.filter(cell=>!hasCell(chunk,chunkCell(cell.key).index))
    if(!cells.length){store.onChange({cx,cy,key:`${cx}/${cy}`});done=true;return}
    if(chunk.completedYears&(1<<y))return
    const year=cohort.firstEndYear+y,annualCohort={firstEndYear:year,years:1,startDate:`${year-1}-09-01`,endDate:`${year}-08-31`}
    const loaded=await source.load({...area,cells},annualCohort,{priority});let saved=false
    this.onProcessing(area.key,true)
    try{
     let slice=performance.now()
     for(const cell of cells){
      const annual=estimateAnnualSeasons(loaded.inputForCell(cell.localIndex),annualCohort)
      setChunkYearCell(chunk,chunkCell(cell.key).index,y,annual)
      if(performance.now()-slice>=6){await yieldTask();slice=performance.now()}
     }
     chunk.completedYears|=1<<y;chunk.revision++
     done=chunk.completedYears===allYears
     if(done)finishChunkCells(chunk,cells.map(cell=>chunkCell(cell.key).index))
     this.onProcessing(area.key,false)
     await store.saveChunk(chunk,{notify:done});saved=true
    }finally{this.onProcessing(area.key,false);source.release(loaded.key,{keep:!saved})}
   })
   if(done)return
  }
 }
}
