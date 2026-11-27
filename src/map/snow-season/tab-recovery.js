/** Resume and liveness policy only; background collection is never paused here.
 * Cancel the probe when hidden so a suspended timer cannot restart a healthy
 * worker before it has had an opportunity to answer on the next foreground. */
export class SnowTabRecovery{
 constructor({resume,restart,flush=()=>{},windowTarget=globalThis,documentTarget=globalThis.document,timeoutMs=10000,debounceMs=50}){
  Object.assign(this,{resume,restart,flush,windowTarget,documentTarget,timeoutMs,debounceMs});this.timer=null;this.probe=null;this.force=false;this.disposed=false
  this.visible=()=>{if(documentTarget.visibilityState!=='hidden')this.request() ;else this.suspend()}
  this.shown=()=>this.request();this.online=()=>this.request(true);this.hidden=()=>{try{this.flush()}catch{/* A discarded worker cannot flush. */}this.suspend()}
  documentTarget.addEventListener('visibilitychange',this.visible);windowTarget.addEventListener('pageshow',this.shown);windowTarget.addEventListener('online',this.online);windowTarget.addEventListener('pagehide',this.hidden)
 }
 request(force=false){
  if(this.disposed)return
  this.force||=force
  if(this.documentTarget.visibilityState==='hidden')return
  if(this.probe){if(!force)return;this.probe.abort();this.probe=null}
  clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;this.check()},this.debounceMs)
 }
 check(){
  if(this.disposed||this.documentTarget.visibilityState==='hidden')return
  const controller=this.probe=new AbortController(),force=this.force;this.force=false
  const timeout=setTimeout(()=>{
   if(this.probe!==controller)return
   if(this.documentTarget.visibilityState==='hidden'){this.probe=null;controller.abort();return}
   this.probe=null;controller.abort();this.restart()
  },this.timeoutMs)
  Promise.resolve().then(()=>this.resume(force,{signal:controller.signal})).catch(()=>{
   if(this.probe!==controller||controller.signal.aborted)return
   this.probe=null;this.restart()
  }).finally(()=>{clearTimeout(timeout);if(this.probe===controller)this.probe=null})
 }
 suspend(){clearTimeout(this.timer);this.timer=null;if(this.probe){this.probe.abort();this.probe=null}}
 dispose(){this.disposed=true;this.suspend();this.documentTarget.removeEventListener('visibilitychange',this.visible);this.windowTarget.removeEventListener('pageshow',this.shown);this.windowTarget.removeEventListener('online',this.online);this.windowTarget.removeEventListener('pagehide',this.hidden)}
}
