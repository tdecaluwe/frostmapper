import {writeFile} from 'node:fs/promises'
import {SnowSeasonEstimator} from '../../src/map/snow-season/season-estimator.js'
import {NveSnowDepthSource} from '../../src/map/snow-season/nve-source.js'
const args=process.argv.slice(2),x=Number(args[0]),y=Number(args[1]),output=args[2]
if(args.length!==3||!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Usage: node tools/snow-season/sample.mjs UTM33_X UTM33_Y output.json')
const estimator=new SnowSeasonEstimator(),source=new NveSnowDepthSource(),cohort=estimator.cohort
const started=performance.now(),input=await source.load({x,y,startDate:cohort.startDate,endDate:cohort.endDate})
const result={...estimator.estimate(input),source:input.source,quality:input.quality,elapsedMs:performance.now()-started}
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({output,status:result.status,period:result.period,lengthDays:result.lengthDays,quality:result.quality,elapsedMs:result.elapsedMs},null,2))
