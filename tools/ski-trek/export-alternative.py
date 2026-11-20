from pathlib import Path
import json,math,copy,xml.etree.ElementTree as ET
import numpy as np
root=Path(__import__('sys').argv[1]);out=Path(__import__('sys').argv[2]);m=json.loads((root/'meta.json').read_text());info=json.loads((root/'alternative-results.json').read_text())[0];r=info['options']['18000'];path=np.fromfile(root/r['pathfile'],dtype=np.int32).reshape(-1,2);h=np.load(root/'height.npy',mmap_mode='r');world=256*2**m['z']
def coords(path):
 return [[round((x+m['xmin']*256+.5)/world*360-180,7),round(math.degrees(math.atan(math.sinh(math.pi*(1-2*(y+m['ymin']*256+.5)/world)))),7),round(float(h[y,x]),2)] for y,x in path]
d=np.diff(path,axis=0);keep=np.r_[True,np.any(d[1:]!=d[:-1],axis=1),True]
p=dict(day=6,start='Tjønnebu',end='Vakkerstøylen',alternative=True,distance_km=round(r['distance_m']/1000,3),max_slope_deg=r['threshold_deg'],ascent_m=round(r['ascent_m']),descent_m=round(r['descent_m']),minimum_separation_m=500,shared_approaches_radius_m=1500,maximum_elevation_m=round(float(h[path[:,0],path[:,1]].max())))
f={'type':'Feature','properties':p,'geometry':{'type':'LineString','coordinates':coords(path[keep])}}
data=json.loads((out/'route.geojson').read_text());data['return_alternative']=f;(out/'route.geojson').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')))
ns='http://www.topografix.com/GPX/1/1';ET.register_namespace('',ns)
track=ET.Element('{'+ns+'}trk');ET.SubElement(track,'{'+ns+'}name').text='Day 6 alternative: Tjønnebu – Vakkerstøylen'
ET.SubElement(track,'{'+ns+'}desc').text='Terrain-only distinct-return candidate: 12.9 km, 26.8 degrees maximum DEM slope; 500 m exclusion around outbound outside 1.5 km hut approaches.'
seg=ET.SubElement(track,'{'+ns+'}trkseg')
for lon,lat,alt in coords(path):
 pt=ET.SubElement(seg,'{'+ns+'}trkpt',lat=str(lat),lon=str(lon));ET.SubElement(pt,'{'+ns+'}ele').text=str(alt)
only=ET.Element('{'+ns+'}gpx',version='1.1',creator='Frostmapper');only.append(copy.deepcopy(track));ET.ElementTree(only).write(out/'return-alternative.gpx',encoding='utf-8',xml_declaration=True)
full=ET.parse(out/'tafjord-ski-trek.gpx');last=full.getroot().findall('{'+ns+'}trk')[-1];full.getroot().remove(last);full.getroot().append(track);full.write(out/'tafjord-ski-trek-distinct-return.gpx',encoding='utf-8',xml_declaration=True)
print(json.dumps(p,ensure_ascii=False))
