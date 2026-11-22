"""Check current map/export routes against the confirmed cliff crossing.

Optionally pass an exporter output directory to check regenerated artifacts.
This checks the known defect, not the safety of the remaining candidates.
"""
import json
import math
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
folder = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'data/ski-trek'
report = json.loads((root / 'data/ski-trek/cliff-validation.json').read_text())
lon, lat = report['location']
scale = (111320 * math.cos(math.radians(lat)), 111320)

def distance(a, b):
    a = ((a[0] - lon) * scale[0], (a[1] - lat) * scale[1])
    b = ((b[0] - lon) * scale[0], (b[1] - lat) * scale[1])
    dx, dy = b[0] - a[0], b[1] - a[1]
    norm = dx * dx + dy * dy
    t = max(0, min(1, -(a[0] * dx + a[1] * dy) / norm)) if norm else 0
    return math.hypot(a[0] + t * dx, a[1] + t * dy)

def check(points, label):
    assert min(distance(a, b) for a, b in zip(points, points[1:])) > 25, label

# The segment that exposed the problem must be detected even though neither
# endpoint is within the excluded neighborhood.
assert distance((7.662019729614258, 62.1467004252501),
                (7.660818099975586, 62.150630058197265)) < 1
data = json.loads((folder / 'exposure-routes.geojson').read_text())
assert data['terrain_validation']['rejected_route_ids'] == ['C', 'E']
for key in ('features', 'day1_options', 'day6_options', 'diagnostics', 'additional_routes'):
    for feature in data[key]:
        check(feature['geometry']['coordinates'], (key, feature['properties']['id']))
ns = {'g': 'http://www.topografix.com/GPX/1/1'}
for name in ('day1-exposure-options.gpx', 'exposure-trek.gpx'):
    for segment in ET.parse(folder / name).findall('.//g:trkseg', ns):
        points = [(float(p.attrib['lon']), float(p.attrib['lat'])) for p in segment]
        check(points, name)
print('Current map and GPX routes avoid the confirmed cliff crossing')
