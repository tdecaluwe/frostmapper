import proj4 from 'proj4'
import {register} from 'ol/proj/proj4.js'
import {get} from 'ol/proj.js'
proj4.defs('EPSG:3035','+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs')
register(proj4)
get('EPSG:3035').setExtent([1900000,900000,6900000,5500000])
