const escapeXML=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]))

// Owns route identity, the selected itinerary, and download resources.
export class RouteCatalog {
 constructor(data){
  this.data=data;this.routes=new Map();this.selected=Array.from({length:6},()=>null);this.planURL=null
  for(const list of ['features','day1_options','day6_options','diagnostics','additional_routes'])for(const f of data[list]||[])this.routes.set(f.properties.id,f)
  for(const f of data.features)this.selected[f.properties.day-1]=f.properties.id
  this.identities=new Map();for(const [id,route] of this.routes){const key=route.properties.minimum_id||id;if(!this.identities.has(key))this.identities.set(key,[]);this.identities.get(key).push(id)}
 }
 get(id){return this.routes.get(id)}
 identical(id){return this.identities.get(this.get(id)?.properties.minimum_id||id)||[id]}
 profile(id){const route=this.get(id);return this.data.profiles?.[route?.properties.profile_id||id]}
 canSelect(id){const p=this.get(id)?.properties,current=p?.day?this.get(this.selected[p.day-1])?.properties:null;return Boolean(p&&p.day>=1&&p.day<=6&&!p.different_endpoint&&current&&p.start===current.start&&p.end===current.end)}
 select(id){if(!this.canSelect(id))return false;this.selected[this.get(id).properties.day-1]=id;this.clearPlanURL();return true}
 selectedRoutes(){return this.selected.map(id=>this.get(id)).filter(Boolean)}
 clearPlanURL(){if(this.planURL)URL.revokeObjectURL(this.planURL);this.planURL=null}
 gpx(routes){
  const tracks=routes.map(f=>{const p=f.properties,points=f.geometry.coordinates.map(([lon,lat,h])=>`<trkpt lat="${lat}" lon="${lon}"><ele>${h}</ele></trkpt>`).join('');return `<trk><name>${escapeXML(`${p.day?`Day ${p.day} `:''}${p.id}: ${p.start} – ${p.end}`)}</name><desc>${escapeXML(`Kartverket 1 m terrain model; ${p.label}; filtered ascent ${Math.round(p.ascent_m)} m, descent ${Math.round(p.descent_m)} m`)}</desc><trkseg>${points}</trkseg></trk>`}).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Frostmapper">${tracks}</gpx>`
 }
 routeURL(id){return URL.createObjectURL(new Blob([this.gpx([this.get(id)])],{type:'application/gpx+xml'}))}
 getPlanURL(){if(!this.planURL)this.planURL=URL.createObjectURL(new Blob([this.gpx(this.selectedRoutes())],{type:'application/gpx+xml'}));return this.planURL}
}
