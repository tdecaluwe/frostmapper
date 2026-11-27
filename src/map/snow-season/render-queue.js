const cancelled=()=>new DOMException('Snow render superseded','AbortError')
/** One cooperative renderer. Equal requests share work; fine visible tiles can
 * interrupt preload work. Inspection requests bypass this queue entirely. */
export class SnowRenderQueue{
 constructor(render,{priority=()=>0}={}){this.render=render;this.priority=priority;this.jobs=new Map();this.active=null;this.selection=0}
 request(data){
  const selection=data.selection??0
  if(selection<this.selection)return Promise.reject(cancelled())
  if(selection>this.selection){
   this.selection=selection
   for(const [key,job] of this.jobs)if(job.selection<selection){
    this.jobs.delete(key);job.controller?.abort(cancelled());for(const waiter of job.waiters)waiter.reject(cancelled());job.waiters=[]
   }
  }
  const key=`${selection}/${data.metric}/${data.minimumDepth??0}/${data.z}/${data.x}/${data.y}`
  let job=this.jobs.get(key)
  if(!job){job={key,data,selection,waiters:[],controller:null,preempted:false};this.jobs.set(key,job)}
  const promise=new Promise((resolve,reject)=>job.waiters.push({resolve,reject}))
  if(this.active&&this.priority(data)>this.priority(this.active.data)){
   this.active.preempted=true;this.active.controller.abort(cancelled())
  }
  this.pump();return promise
 }
 pump(){
  if(this.active)return
  let next=null
  for(const job of this.jobs.values())if(job.waiters.length&&(!next||this.priority(job.data)>this.priority(next.data)))next=job
  if(!next)return
  this.active=next;next.preempted=false;next.controller=new AbortController()
  Promise.resolve().then(()=>this.render(next.data,{signal:next.controller.signal})).then(pixels=>{
   if(next.controller.signal.aborted)throw next.controller.signal.reason
   this.jobs.delete(next.key);for(let i=0;i<next.waiters.length;i++)next.waiters[i].resolve(i===next.waiters.length-1?pixels:pixels.slice());next.waiters=[]
  }).catch(error=>{
   if(next.preempted&&next.selection===this.selection&&next.waiters.length)return
   this.jobs.delete(next.key);for(const waiter of next.waiters)waiter.reject(error);next.waiters=[]
  }).finally(()=>{this.active=null;this.pump()})
 }
}
