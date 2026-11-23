const node=(name,text,className)=>{const e=document.createElement(name);if(text)e.textContent=text;if(className)e.className=className;return e}
const svgNode=(name,attributes={},text)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v] of Object.entries(attributes))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e}
const metres=value=>`${Math.round(value).toLocaleString()} m`

// Owns the bottom sheet and its responsive profile. No work runs in map frames.
export class RouteDetailsPanel {
 constructor({onClose,onFit,onUse,onDistance,onChoose}){
  this.onClose=onClose;this.onDistance=onDistance;this.root=node('section',null,'route-details');this.root.id='route-details';this.root.hidden=true;this.root.setAttribute('aria-label','Route details')
  const header=node('div',null,'route-details-header');this.title=node('h2');this.title.id='route-details-title';this.root.setAttribute('aria-labelledby',this.title.id)
  const close=node('button','×','route-details-close');close.type='button';close.setAttribute('aria-label','Close route details');close.addEventListener('click',()=>this.hide());header.append(this.title,close)
  this.description=node('p',null,'route-details-description');this.nearby=node('select');this.nearby.className='route-overlap';this.nearby.setAttribute('aria-label','Routes at this point');this.nearby.addEventListener('change',()=>onChoose(this.nearby.value));this.metrics=node('dl',null,'route-metrics');this.graph=document.createElementNS('http://www.w3.org/2000/svg','svg');this.graph.classList.add('route-profile');this.graph.setAttribute('role','img');this.graph.setAttribute('tabindex','0');this.graph.setAttribute('aria-label','Elevation profile. Use left and right arrows to inspect the route.');this.readout=node('output',null,'route-profile-readout')
  const graphHeader=node('div',null,'route-profile-header');graphHeader.append(node('span','Elevation profile'),this.readout)
  const actions=node('div',null,'route-details-actions');this.fit=node('button','Fit route');this.fit.type='button';this.fit.addEventListener('click',()=>onFit(this.id));this.use=node('button');this.use.type='button';this.use.addEventListener('click',()=>onUse(this.id));this.download=node('a','GPX');this.download.download='route.gpx';actions.append(this.fit,this.use,this.download)
  this.note=node('small',null,'route-details-note');this.root.append(header,this.description,this.nearby,this.metrics,graphHeader,this.graph,actions,this.note);document.body.append(this.root)
  this.graph.addEventListener('pointermove',event=>{if(!this.chart)return;const r=this.graph.getBoundingClientRect();this.inspect((event.clientX-r.left-this.chart.left)/this.chart.width*this.chart.distance)})
  this.graph.addEventListener('pointerleave',()=>{this.cursor?.setAttribute('visibility','hidden');this.dot?.setAttribute('visibility','hidden');onDistance(null)})
  this.graph.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!this.chart)return;event.preventDefault();event.stopPropagation();const d=event.key==='Home'?0:event.key==='End'?this.chart.distance:(this.inspected||0)+(event.key==='ArrowLeft'?-50:50);this.inspect(d)})
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!this.root.hidden)this.hide()})
  this.resize=new ResizeObserver(()=>{if(this.root.hidden)return;document.documentElement.style.setProperty('--route-panel-height',`${this.root.getBoundingClientRect().height}px`);this.draw()});this.resize.observe(this.root)
 }
 show(route,profile,{color,canUse,isSelected,url,choices=[]}){
  this.route=route;this.profile=profile;this.color=color;this.id=route.properties.id;const p=route.properties
  this.title.textContent=`${p.id} · ${p.start} → ${p.end}`;this.description.textContent=p.label
  this.nearby.replaceChildren(...choices.map(({id,label})=>{const option=node('option',label);option.value=id;return option}));this.nearby.value=this.id;this.nearby.hidden=choices.length<2
  this.metrics.replaceChildren()
  for(const [label,value] of [['Distance',`${p.distance_km.toFixed(1)} km`],['Ascent',metres(p.ascent_m)],['Descent',metres(p.descent_m)],['Terrain max · 1 m',`${p.max_slope_deg.toFixed(1)}°`],['Ground above 15°',metres(p.distance_above_15_m)],['Cost equivalent',`${(p.weighted_cost_m/1000).toFixed(1)} km`]]){const item=node('div');item.append(node('dt',label),node('dd',value));this.metrics.append(item)}
  this.use.hidden=!canUse;this.use.disabled=isSelected;this.use.textContent=isSelected?`Selected for day ${p.day}`:`Use for day ${p.day}`;this.download.href=url;this.download.download=`frostmapper-${p.id}.gpx`
  this.note.textContent='Kartverket 1 m terrain. Gain: 5 m sampling, 10 m Gaussian smoothing, 3 m reversal threshold.'
  if(p.minimum_selection)this.note.textContent+=` Minimum search: length limit ${(p.minimum_selection.maximum_distance_m/1000).toFixed(1)} km (2× shortest minimum); cost ≤${Math.round(p.minimum_selection.maximum_cost_m/p.minimum_selection.best_cost_m*100)}% of best.`
  if(p.constraint_checks?.length)this.description.textContent+=` · ${p.constraint_checks.map(c=>c.name==='Midthøa'?`${c.name}: ${Math.round(c.minimum_distance_m)} m`:c.name).join(' · ')}`
  this.root.hidden=false;document.body.classList.add('route-details-open');this.readout.textContent='';this.inspected=null;this.draw()
 }
 hide(){this.root.hidden=true;document.body.classList.remove('route-details-open');document.documentElement.style.removeProperty('--route-panel-height');this.onDistance(null);this.onClose()}
 draw(){
  if(!this.profile?.distance_m?.length){this.chart=null;this.graph.replaceChildren(svgNode('text',{x:20,y:40},'Profile unavailable'));return}
  const width=Math.max(280,this.graph.clientWidth||600),height=Math.max(100,this.graph.clientHeight||145),left=50,right=12,top=10,bottom=24,plotWidth=width-left-right,plotHeight=height-top-bottom,d=this.profile.distance_m,h=this.profile.elevation_m,last=d.at(-1),lo=Math.floor(Math.min(...h)/50)*50,hi=Math.max(lo+50,Math.ceil(Math.max(...h)/50)*50)
  this.chart={left,width:plotWidth,distance:last,x:value=>left+value/last*plotWidth,y:value=>top+(hi-value)/(hi-lo)*plotHeight};this.graph.setAttribute('viewBox',`0 0 ${width} ${height}`);this.graph.replaceChildren()
  for(let i=0;i<3;i++){const value=lo+(hi-lo)*i/2,y=this.chart.y(value);this.graph.append(svgNode('line',{x1:left,x2:width-right,y1:y,y2:y,class:'profile-grid'}),svgNode('text',{x:left-6,y:y+4,'text-anchor':'end'},Math.round(value)+' m'))}
  for(let i=0;i<5;i++){const value=last*i/4;this.graph.append(svgNode('text',{x:this.chart.x(value),y:height-4,'text-anchor':i===0?'start':i===4?'end':'middle'},(value/1000).toFixed(1)+' km'))}
  // Preserve each screen column's extrema rather than averaging peaks away.
  const points=[];let start=0
  while(start<d.length){const bucket=Math.floor(d[start]/last*plotWidth);let end=start,min=start,max=start;while(end+1<d.length&&Math.floor(d[end+1]/last*plotWidth)===bucket){end++;if(h[end]<h[min])min=end;if(h[end]>h[max])max=end}for(const index of [...new Set([start,min,max,end])].sort((a,b)=>a-b))points.push([this.chart.x(d[index]),this.chart.y(h[index])]);start=end+1}
  const line=points.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(''),area=line+`L${this.chart.x(last)},${height-bottom}L${left},${height-bottom}Z`
  this.graph.append(svgNode('path',{d:area,fill:this.color,'fill-opacity':.1}),svgNode('path',{d:line,fill:'none',stroke:this.color,'stroke-width':1.6}))
  this.cursor=svgNode('line',{y1:top,y2:height-bottom,stroke:'#596971','stroke-dasharray':'3 3',visibility:'hidden'});this.dot=svgNode('circle',{r:3.5,fill:this.color,stroke:'white','stroke-width':1.5,visibility:'hidden'});this.graph.append(this.cursor,this.dot)
 }
 inspect(value){
  if(!this.chart)return;const d=Math.max(0,Math.min(this.chart.distance,value)),xs=this.profile.distance_m,ys=this.profile.elevation_m;let low=0,high=xs.length-1;while(low+1<high){const mid=(low+high)>>1;if(xs[mid]<d)low=mid;else high=mid}const fraction=(d-xs[low])/(xs[high]-xs[low]||1),height=ys[low]+fraction*(ys[high]-ys[low]);this.inspected=d
  const x=this.chart.x(d),y=this.chart.y(height);this.cursor.setAttribute('x1',x);this.cursor.setAttribute('x2',x);this.cursor.setAttribute('visibility','visible');this.dot.setAttribute('cx',x);this.dot.setAttribute('cy',y);this.dot.setAttribute('visibility','visible');this.readout.textContent=`${(d/1000).toFixed(2)} km · ${Math.round(height)} m`;this.onDistance(d)
 }
}
