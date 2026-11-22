from pathlib import Path
import json,math,copy,xml.etree.ElementTree as ET
import numpy as np
from importlib.machinery import SourceFileLoader
root=Path(__import__('sys').argv[1]);out=Path(__import__('sys').argv[2]);m=json.loads((root/'meta.json').read_text());h=np.load(root/'height.npy',mmap_mode='r');analyzer=SourceFileLoader('analysis',str(Path(__file__).with_name('analyze-exposure.py'))).load_module();world=256*2**m['z']
variants=[('A','Shorter day','day1-cap-29.9-lambda-0.5.bin'),('B','Lower peak slope, under 18 km','day1-cap-25-lambda-0.5.bin'),('C','Lower peak slope, about 20 km','day1-cap-25-lambda-0.1.bin'),('D','Least steep-ground distance found','day1-cap-29.9-lambda-0.02.bin'),('E','Lowest peak among daily candidates','day1-cap-23.5-lambda-0.03.bin')]
def coordinates(points):
 return [[float((int(x)+m['xmin']*256+.5)/world*360-180),float(math.degrees(math.atan(math.sinh(math.pi*(1-2*(int(y)+m['ymin']*256+.5)/world))))),float(h[y,x])] for y,x in points]
def feature(day,pathfile,id,label,diagnostic=False,endpoints=None):
 p=np.fromfile(root/pathfile,dtype=np.int32).reshape(-1,2);stats=analyzer.analyze(pathfile)
 assert diagnostic or stats['distance_km']<=(35 if day==6 else 25)
 a,b=endpoints if endpoints else ((m['huts'][5],m['huts'][4]) if day==6 else (m['huts'][day-1],m['huts'][day]))
 stats.update(day=day,id=id,label=label,start=a['name'],end=b['name'],diagnostic=diagnostic)
 d=np.diff(p,axis=0);keep=np.r_[True,np.any(d[1:]!=d[:-1],axis=1),True]
 return {'type':'Feature','properties':stats,'geometry':{'type':'LineString','coordinates':coordinates(p[keep])}},coordinates(p)
options=[];raw={}
for id,label,f in variants:
 feat,points=feature(1,f,id,label);options.append(feat);raw[id]=points
features=[copy.deepcopy(options[3])]
for day,pathfile in [(2,'day2-lambda-0.001.bin'),(3,'day3-lambda-0.001.bin'),(4,'day4-lambda-0.001.bin'),(5,'day5-lambda-0.001.bin')]:
 f,points=feature(day,pathfile,str(day),'Least steep-ground distance found');features.append(f);raw[str(day)]=points
f=copy.deepcopy(features[-1]);p=f['properties'];p['day']=6;p['id']='R';p['start'],p['end']=p['end'],p['start'];p['ascent_m'],p['descent_m']=p['descent_m'],p['ascent_m'];p['label']='Reverse of day 5';f['geometry']['coordinates'].reverse();features.append(f);raw['R']=list(reversed(raw['5']));p['retrace']=True
returns=[copy.deepcopy(f)]
for id,label,pathfile in [('F','Lower-valley diversion; shares upper route','exposure-return-gate-0.25-lambda-0.01.bin'),('G','Upper-valley detour; steeper','exposure-return-gate-0.5-lambda-0.1.bin')]:
 ret,points=feature(6,pathfile,id,label);assert ret['properties']['distance_km']<=35
 returns.append(ret);raw[id]=points

diagnostics=[];diagnostic_raw={}
for id,label,pathfile,download in [('T','Sub-20° to Torsbu; shorter','torsbu-under20-long.bin','day1-under20-torsbu.gpx'),('U','Sub-20° to Torsbu; less steep ground','torsbu-under20-exposure-long.bin','day1-under20-torsbu-low-exposure.gpx')]:
 f,points=feature(1,pathfile,id,label,True,endpoints=(m['huts'][0],m['huts'][2]));f['properties'].update(different_endpoint=True,over_daily_limit=bool(f['properties']['distance_km']>25),download=download)
 diagnostics.append(f);diagnostic_raw[id]=points
extra_legs={id:(a,b) for id,a,b in json.loads((root/'extra-legs.json').read_text())}
additional=[]
for id,leg,label,pathfile in [('VP','VP','Direct: least steep ground','extra-VP-lambda-0.01.bin'),('VPm','VP','Direct: balanced','extra-VP-lambda-0.1.bin'),('VPs','VP','Direct: shorter and steeper','extra-VP-lambda-1000.bin'),('VJ','VJ','Vakkerstøylen to Jervebua','extra-VJ-lambda-1000.bin'),('JM','JM','Mebua: no terrain above 15°','extra-JM-lambda-0.01.bin'),('JMc','JM','Mebua: under 20° terrain','extra-JM-cap20-lambda-1.bin'),('JMm','JM','Mebua: shorter, less steep ground','extra-JM-lambda-0.1.bin'),('JMs','JM','Mebua: shortest and steeper','extra-JM-lambda-1000.bin')]:
 f,points=feature(0,pathfile,id,label,endpoints=extra_legs[leg]);f['properties'].update(standalone=True,download=f'additional-{id}.gpx')
 additional.append(f);raw[id]=points

method={'objective':'Minimize horizontal ground distance on terrain slope >15 degrees; compare supported distance/maximum-grade tradeoffs. Below 10 degrees, no heading constraint.','heading_rule':'For slope s > 10 degrees: absolute deviation from uphill OR downhill fall line <= 90 - 3*s degrees.','search':'Direction-aware weighted shortest paths: cost = distance_above_15 + lambda*total_distance, with terrain caps 20,22.5,25,29.9 and sampled lambda values. These are candidate Pareto options, not a certified global resource-constrained optimum.','limits':{'preferred_km':18,'maximum_km':25,'return_alternative_maximum_km':35},'grid':'Terrarium z13, ~8.9 m latitude-corrected cells; 176 primitive travel directions, exact segment/cell clipping. Corner-touching cells must satisfy the cap; positive-length intersections must satisfy the heading rule. Long flat-region moves may use a shorter direction stencil.','day1_under20':'Sub-20-degree alternatives now run Danskehytta to Torsbu. Shorter: 26.961 km; lower exposure: 32.705 km. Both exceed the unchanged 25 km daily limit and remain separate overnight alternatives, not part of the selected six-day GPX.','validation':'Independent Python re-integration of every positive-length segment/cell intersection; all heading-rule excesses <0 degrees. Coordinates retain double precision to preserve tight heading margins.','scope':'Terrain-only model; snow, ice, avalanche exposure and obstacles not modeled.'}
data={'type':'FeatureCollection','name':'Tafjord ski trek — steep-ground exposure and fall-line constraint','method':method,'features':features,'day1_options':options,'diagnostics':diagnostics,'day6_options':returns,'additional_routes':additional}
(out/'exposure-routes.geojson').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
ns='http://www.topografix.com/GPX/1/1';ET.register_namespace('',ns)
def gpx(items,path):
 doc=ET.Element('{'+ns+'}gpx',version='1.1',creator='Frostmapper direction-aware terrain routing')
 for f,points in items:
  p=f['properties'];trk=ET.SubElement(doc,'{'+ns+'}trk');ET.SubElement(trk,'{'+ns+'}name').text=f"{('Day '+str(p['day'])) if p['day'] else 'Link'} {p['id']}: {p['start']} – {p['end']}"
  ET.SubElement(trk,'{'+ns+'}desc').text=f"{p['label']}; {p['distance_km']:.3f} km; {p['distance_above_15_m']:.1f} m on terrain above 15 deg; max terrain {p['max_slope_deg']:.2f} deg. Fall-line deviation <=90-3*slope above 10 deg."
  seg=ET.SubElement(trk,'{'+ns+'}trkseg')
  for lon,lat,alt in points:
   pt=ET.SubElement(seg,'{'+ns+'}trkpt',lat=repr(lat),lon=repr(lon));ET.SubElement(pt,'{'+ns+'}ele').text=repr(alt)
 ET.ElementTree(doc).write(out/path,encoding='utf-8',xml_declaration=True)
gpx([(f,raw[f['properties']['id']]) for f in features],'exposure-trek.gpx')
gpx([(f,raw[f['properties']['id']]) for f in options],'day1-exposure-options.gpx')
gpx([(f,raw[f['properties']['id']]) for f in returns],'return-exposure-options.gpx')
for f in diagnostics:gpx([(f,diagnostic_raw[f['properties']['id']])],f['properties']['download'])
for f in additional:gpx([(f,raw[f['properties']['id']])],f['properties']['download'])
gpx([(f,raw[f['properties']['id']]) for f in additional],'additional-route-options.gpx')
(root/'exposure-summary.json').write_text(json.dumps({'options':[f['properties'] for f in options],'days':[f['properties'] for f in features],'diagnostics':[f['properties'] for f in diagnostics],'additional':[f['properties'] for f in additional]},indent=2,ensure_ascii=False))
print(json.dumps({'options':[(f['properties']['id'],round(f['properties']['distance_km'],2),round(f['properties']['distance_above_15_m']),round(f['properties']['max_slope_deg'],1)) for f in options],'days':[(f['properties']['day'],round(f['properties']['distance_km'],2),round(f['properties']['distance_above_15_m']),round(f['properties']['max_slope_deg'],1)) for f in features]}))
