import proj4 from 'proj4'
import {register} from 'ol/proj/proj4.js'
import {get} from 'ol/proj.js'
import {registerPeirce,registerAffine,registerPipeline,PEIRCE_CODE,PEIRCE_EXTENT,PEIRCE_WORLD_EXTENT} from './peirce.js'
registerPeirce(proj4)
registerAffine(proj4)
registerPipeline(proj4)
proj4.defs('EPSG:3035','+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs')
register(proj4)
get('EPSG:3035').setExtent([1900000,900000,6900000,5500000])

get(PEIRCE_CODE).setExtent(PEIRCE_EXTENT)
get(PEIRCE_CODE).setWorldExtent(PEIRCE_WORLD_EXTENT)
