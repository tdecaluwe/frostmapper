from pathlib import Path
import json,math,copy,xml.etree.ElementTree as ET
import numpy as np
from importlib.machinery import SourceFileLoader
root=Path(__import__('sys').argv[1]);out=Path(__import__('sys').argv[2]);m=json.loads((root/'meta.json').read_text());h=np.load(root/'height.npy',mmap_mode='r');analyzer=SourceFileLoader('analysis',str(Path(__file__).with_name('analyze-exposure.py'))).load_module();world=256*2**m['z']
variants=[('A','Shorter day','exposure-day-1-cap-29.9-lambda-0.5.bin'),('B','Lower peak slope, under 18 km','exposure-day-1-cap-25-lambda-1.bin'),('C','Lower peak slope, about 20 km','exposure-day-1-cap-25-lambda-0.1.bin'),('D','Least steep-ground distance found','exposure-day-1-cap-29.9-lambda-0.02.bin'),('E','Lowest peak among daily candidates','exposure-day-1-cap-25-lambda-0.02.bin')]
def coordinates(points):
 return [[float((int(x)+m['xmin']*256+.5)/world*360-180),float(math.degrees(math.atan(math.sinh(math.pi*(1-2*(int(y)+m['ymin']*256+.5)/world))))),float(h[y,x])] for y,x in points]
def feature(day,pathfile,id,label,diagnostic=False):
 p=np.fromfile(root/pathfile,dtype=np.int32).reshape(-1,2);stats=analyzer.analyze(pathfile)
 assert diagnostic or stats['distance_km']<=(35 if day==6 else 25)
 a=m['huts'][5] if day==6 else m['huts'][day-1];b=m['huts'][4] if day==6 else m['huts'][day]
 stats.update(day=day,id=id,label=label,start=a['name'],end=b['name'],diagnostic=diagnostic)
 d=np.diff(p,axis=0);keep=np.r_[True,np.any(d[1:]!=d[:-1],axis=1),True]
 return {'type':'Feature','properties':stats,'geometry':{'type':'LineString','coordinates':coordinates(p[keep])}},coordinates(p)
options=[];raw={}
for id,label,f in variants:
 feat,points=feature(1,f,id,label);options.append(feat);raw[id]=points
features=[copy.deepcopy(options[3])]
for day,pathfile in [(2,'exposure-day-2-lambda-0.001.bin'),(3,'exposure-day-3-lambda-0.001.bin'),(4,'exposure-day-4-lambda-0.001.bin'),(5,'exposure-day-5-lambda-0.001.bin')]:
 f,points=feature(day,pathfile,str(day),'Least steep-ground distance found');features.append(f);raw[str(day)]=points
f=copy.deepcopy(features[-1]);p=f['properties'];p['day']=6;p['id']='R';p['start'],p['end']=p['end'],p['start'];p['ascent_m'],p['descent_m']=p['descent_m'],p['ascent_m'];p['label']='Reverse of day 5';f['geometry']['coordinates'].reverse();features.append(f);raw['R']=list(reversed(raw['5']));p['retrace']=True
returns=[copy.deepcopy(f)]
for id,label,pathfile in [('F','Lower-valley diversion; shares upper route','exposure-return-gate-0.25-lambda-0.01.bin'),('G','Eastern loop; steeper','exposure-return-gate-0.1-lambda-0.01.bin')]:
 ret,points=feature(6,pathfile,id,label);assert ret['properties']['distance_km']<=35
 returns.append(ret);raw[id]=points

diagnostic,diagnostic_points=feature(1,'day1-under20-long.bin','under20','Sub-20° diagnostic — exceeds 25 km limit',True)
method={'objective':'Minimize horizontal ground distance on terrain slope >15 degrees; compare supported distance/maximum-grade tradeoffs. Below 10 degrees, no heading constraint.','heading_rule':'For slope s > 10 degrees: absolute deviation from uphill OR downhill fall line <= 30 - s degrees.','search':'Direction-aware weighted shortest paths: cost = distance_above_15 + lambda*total_distance, with terrain caps 20,22.5,25,29.9 and sampled lambda values. These are candidate Pareto options, not a certified global resource-constrained optimum.','limits':{'preferred_km':18,'maximum_km':25,'return_alternative_maximum_km':35},'grid':'Terrarium z13, ~8.9 m latitude-corrected cells; 176 primitive travel directions, exact segment/cell clipping. Corner-touching cells must satisfy the cap; positive-length intersections must satisfy the heading rule. Long flat-region moves may use a shorter direction stencil.','day1_under20':'No path found within the 25 km reachable domain using 176 or 640 directions under a 20-degree cap. A 33.373 km sub-20-degree candidate was found with a larger search domain and is diagnostic only.','validation':'Independent Python re-integration of every positive-length segment/cell intersection; all heading-rule excesses <0 degrees. Coordinates retain double precision to preserve tight heading margins.','scope':'Terrain-only model; snow, ice, avalanche exposure and obstacles not modeled.'}
data={'type':'FeatureCollection','name':'Tafjord ski trek — steep-ground exposure and fall-line constraint','method':method,'features':features,'day1_options':options,'diagnostics':[diagnostic],'day6_options':returns}
(out/'exposure-routes.geojson').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
ns='http://www.topografix.com/GPX/1/1';ET.register_namespace('',ns)
def gpx(items,path):
 doc=ET.Element('{'+ns+'}gpx',version='1.1',creator='Frostmapper direction-aware terrain routing')
 for f,points in items:
  p=f['properties'];trk=ET.SubElement(doc,'{'+ns+'}trk');ET.SubElement(trk,'{'+ns+'}name').text=f"Day {p['day']} {p['id']}: {p['start']} – {p['end']}"
  ET.SubElement(trk,'{'+ns+'}desc').text=f"{p['label']}; {p['distance_km']:.3f} km; {p['distance_above_15_m']:.1f} m on terrain above 15 deg; max terrain {p['max_slope_deg']:.2f} deg. Fall-line deviation <=30-slope above 10 deg."
  seg=ET.SubElement(trk,'{'+ns+'}trkseg')
  for lon,lat,alt in points:
   pt=ET.SubElement(seg,'{'+ns+'}trkpt',lat=repr(lat),lon=repr(lon));ET.SubElement(pt,'{'+ns+'}ele').text=repr(alt)
 ET.ElementTree(doc).write(out/path,encoding='utf-8',xml_declaration=True)
gpx([(f,raw[f['properties']['id']]) for f in features],'exposure-trek.gpx')
gpx([(f,raw[f['properties']['id']]) for f in options],'day1-exposure-options.gpx')
gpx([(f,raw[f['properties']['id']]) for f in returns],'return-exposure-options.gpx')
gpx([(diagnostic,diagnostic_points)],'day1-under20-overlimit.gpx')
(root/'exposure-summary.json').write_text(json.dumps({'options':[f['properties'] for f in options],'days':[f['properties'] for f in features],'diagnostic':diagnostic['properties']},indent=2,ensure_ascii=False))
print(json.dumps({'options':[(f['properties']['id'],round(f['properties']['distance_km'],2),round(f['properties']['distance_above_15_m']),round(f['properties']['max_slope_deg'],1)) for f in options],'days':[(f['properties']['day'],round(f['properties']['distance_km'],2),round(f['properties']['distance_above_15_m']),round(f['properties']['max_slope_deg'],1)) for f in features]}))
