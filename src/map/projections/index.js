import proj4 from 'proj4'
import {register} from 'ol/proj/proj4.js'
import {get} from 'ol/proj.js'
import {registerOblique} from './ob-tran.js'
import {registerPeirce,registerAffine,registerPipeline,definePipeline,PEIRCE_CODE,PEIRCE_EXTENT,PEIRCE_WORLD_EXTENT} from './peirce.js?v=triptychial'
registerPeirce(proj4)
registerAffine(proj4)
registerPipeline(proj4)
registerOblique(proj4)
export const TRIPTYCHIAL_CODE='FROST:TRIPTYCHIAL'
export const TRIPTYCHIAL_DEFINITION='+proj=pipeline +step +proj=ob_tran +o_proj=peirce_q +o_lat_p=-45 +o_lon_p=45 +o_type=horizontal +o_scrollx=-0.25 +step +proj=affine +s11=-1 +s12=0 +s21=0 +s22=-1'
definePipeline(proj4,TRIPTYCHIAL_CODE,TRIPTYCHIAL_DEFINITION)
proj4.defs('EPSG:3035','+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs')
register(proj4)
get('EPSG:3035').setExtent([1900000,900000,6900000,5500000])

get(PEIRCE_CODE).setExtent(PEIRCE_EXTENT)
get(PEIRCE_CODE).setWorldExtent(PEIRCE_WORLD_EXTENT)

get(TRIPTYCHIAL_CODE).setExtent(PEIRCE_EXTENT)
get(TRIPTYCHIAL_CODE).setWorldExtent(PEIRCE_WORLD_EXTENT)
