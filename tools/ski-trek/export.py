from pathlib import Path
import numpy as np,json,math,xml.etree.ElementTree as ET
root=Path(__import__('sys').argv[1]);out=Path(__import__('sys').argv[2]);out.mkdir(exist_ok=True)
m=json.loads((root/'meta.json').read_text());results=json.loads((root/'constrained-results.json').read_text());elevation=np.load(root/'height.npy',mmap_mode='r');world=256*2**m['z']
def coords(path):
 return [[round((c+m['xmin']*256+.5)/world*360-180,7),round(math.degrees(math.atan(math.sinh(math.pi*(1-2*(r+m['ymin']*256+.5)/world)))),7),round(float(elevation[r,c]),2)] for r,c in path]
features=[];legs=[]
for result in results:
 a=result['options']['18000'];b=result['options']['25000'];selected=a if a.get('feasible') else b
 assert selected['feasible'];assert selected['distance_m']<=25000
 path=np.fromfile(root/selected['pathfile'],dtype=np.int32).reshape(-1,2)
 directions=np.diff(path,axis=0);keep=np.r_[True,np.any(directions[1:]!=directions[:-1],axis=1),True]
 geometry={'type':'LineString','coordinates':coords(path[keep])}
 p={k:result[k] for k in ['day','start','end']};p.update(distance_km=round(selected['distance_m']/1000,3),max_slope_deg=selected['threshold_deg'],ascent_m=round(selected['ascent_m']),descent_m=round(selected['descent_m']))
 p['maximum_25km_slope_deg']=b.get('threshold_deg');p['maximum_25km_distance_km']=round(b['distance_m']/1000,3) if b.get('feasible') else None
 features.append({'type':'Feature','properties':p,'geometry':geometry});legs.append((p,coords(path)))
# The return leg has the same minimax objective and reverses the identical path.
f=json.loads(json.dumps(features[-1]));p=f['properties'];p['day']=6;p['start'],p['end']=p['end'],p['start'];p['ascent_m'],p['descent_m']=p['descent_m'],p['ascent_m'];f['geometry']['coordinates'].reverse();features.append(f);legs.append((p,list(reversed(legs[-1][1]))))
collection={'type':'FeatureCollection','name':'Tafjordfjella ski trek — terrain-only minimax routes','method':{'slope_floor_deg':10,'threshold_precision_deg':.1,'distance_preference_km':18,'hard_distance_limit_km':25,'dem':'Mapzen/AWS Terrain Tiles, Terrarium z13; approximately 8.9 m ground pixel spacing; Norwegian terrain data varies by source tile','objective':'Minimize maximum central-difference terrain slope subject to distance limit, then minimize horizontal distance. Eight-neighbor grid; diagonals require both orthogonal cells below threshold. All slope values at or below 10° have equal cost.','scope':'Terrain-only computed candidate tracks; snow, lake ice, avalanche exposure, glaciers, obstacles and bridges are not modeled.','hut_coordinates':'Peakbook UTM32N hut entries 50116, 50118, 50120, 50121, 50122, 50123','same_route_for_18_and_25km':all(r['options']['18000'].get('threshold_deg')==r['options']['25000'].get('threshold_deg') for r in results)},'features':features}
(out/'route.geojson').write_text(json.dumps(collection,ensure_ascii=False,separators=(',',':')))
ns='http://www.topografix.com/GPX/1/1';ET.register_namespace('',ns)
gpx=ET.Element('{'+ns+'}gpx',version='1.1',creator='Frostmapper terrain minimax analysis')
for props,points in legs:
 track=ET.SubElement(gpx,'{'+ns+'}trk');ET.SubElement(track,'{'+ns+'}name').text=f"Day {props['day']}: {props['start']} – {props['end']}"
 ET.SubElement(track,'{'+ns+'}desc').text=f"Terrain-only computed track. {props['distance_km']:.1f} km; DEM minimax threshold {props['max_slope_deg']:.1f} degrees."
 segment=ET.SubElement(track,'{'+ns+'}trkseg')
 for lon,lat,h in points:
  pt=ET.SubElement(segment,'{'+ns+'}trkpt',lat=str(lat),lon=str(lon));ET.SubElement(pt,'{'+ns+'}ele').text=str(h)
ET.ElementTree(gpx).write(out/'tafjord-ski-trek.gpx',encoding='utf-8',xml_declaration=True)
(root/'summary.json').write_text(json.dumps([f['properties'] for f in features],indent=2,ensure_ascii=False))
print(json.dumps(collection['method'],ensure_ascii=False));print((out/'route.geojson').stat().st_size,'GeoJSON bytes')
