"""Structural checks on published native-data routes and their downloadable GPX."""
from pathlib import Path
import json,math,xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[1]/'data/ski-trek'
data=json.loads((root/'exposure-routes.geojson').read_text())
assert 'Kartverket' in data['method']['source']
assert data['method']['heading_scale_m']==10
features=[]
for key in ('features','day1_options','day6_options','diagnostics','additional_routes'):
 for f in data[key]:
  p=f['properties'];coords=f['geometry']['coordinates'];features.append(f)
  assert p['native_validated'] and p['native_cell_checks']>0
  assert p['maximum_angle_rule_excess_deg']<=1e-5
  assert p['heading_scale_m']==10 and p['max_slope_deg']<=p['slope_cap_deg']+1e-5
  assert len(coords)>=2 and all(len(c)==3 and all(math.isfinite(v) for v in c) for c in coords)
  limit=35 if p['day']==6 or p.get('over_daily_limit') else 25
  assert p['distance_km']<=limit+1e-5
  if p.get('download'):assert (root/p['download']).is_file()
if data['plan_complete']:
 ordered=sorted(data['features'],key=lambda f:f['properties']['day'])
 assert [f['properties']['day'] for f in ordered]==list(range(1,7))
 for a,b in zip(ordered,ordered[1:]):
  assert a['geometry']['coordinates'][-1]==b['geometry']['coordinates'][0],('discontinuous itinerary',a['properties']['id'],b['properties']['id'])
for f in data['diagnostics']:
 assert f['properties']['end']=='Torsbu' and f['properties']['max_slope_deg']<=20
ns={'g':'http://www.topografix.com/GPX/1/1'}
for file in ['exposure-trek.gpx','day1-exposure-options.gpx','return-exposure-options.gpx','additional-route-options.gpx']:
 tree=ET.parse(root/file)
 for trk in tree.findall('g:trk',ns):
  assert 'Kartverket' in trk.findtext('g:desc',namespaces=ns) or '1 m DTM' in trk.findtext('g:desc',namespaces=ns)
  assert len(trk.findall('.//g:trkpt',ns))>=2
print(f'Native metadata, distance/heading limits, itinerary continuity and GPX checked for {len(features)} route records')

# Requested named corridors are entered in order, including the initial JM climb.
by_id={f['properties']['id']:f for f in features}
for route_id in ('1b','2','3','JM'):
 checks=by_id[route_id]['properties']['constraint_checks']
 assert checks and all(c['minimum_distance_m']<=c['radius_m'] for c in checks)
 assert [c['path_index'] for c in checks]==sorted(c['path_index'] for c in checks)
jm=by_id['JM']['properties']
assert jm['initial_climb_toward_istjonna_m']>50
assert jm['midthoa_distance_m']<=1000
for f in features:
 p=f['properties'];profile=data['profiles'][p['profile_id']]
 ds,hs=profile['distance_m'],profile['elevation_m']
 assert len(ds)==len(hs) and len(ds)>2 and ds[0]==0
 assert all(math.isfinite(v) for v in ds+hs)
 assert all(b>a for a,b in zip(ds,ds[1:]))
 assert abs(ds[-1]-p['distance_km']*1000)<.02
 assert abs(profile['ascent_m']-profile['descent_m']-(hs[-1]-hs[0]))<.03
 assert p['ascent_m']<=p['ascent_raw_m']+.1
print('Ordered named corridors, initial climb, summit distance and elevation profiles checked')
