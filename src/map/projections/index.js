import proj4 from 'proj4'
import {register} from 'ol/proj/proj4.js'
import {get} from 'ol/proj.js'
import {registerOblique} from './ob-tran.js'
import {registerPeirce,registerAffine,registerPipeline,definePipeline,PEIRCE_CODE,PEIRCE_EXTENT,PEIRCE_WORLD_EXTENT} from './peirce.js?v=triptychial'
import {PROJECTION_STRINGS,TRIPTYCHIAL_CODE,TRIPTYCHIAL_DEFINITION} from './proj-strings.js?v=antarctica-v1'
registerPeirce(proj4)
registerAffine(proj4)
registerPipeline(proj4)
registerOblique(proj4)
export {PROJECTION_STRINGS,TRIPTYCHIAL_CODE,TRIPTYCHIAL_DEFINITION}
definePipeline(proj4,TRIPTYCHIAL_CODE,TRIPTYCHIAL_DEFINITION)
proj4.defs('EPSG:3031',PROJECTION_STRINGS['EPSG:3031'])
proj4.defs('EPSG:3035',PROJECTION_STRINGS['EPSG:3035'])
register(proj4)
get('EPSG:3035').setExtent([1900000,900000,6900000,5500000])

get(PEIRCE_CODE).setExtent(PEIRCE_EXTENT)
get(PEIRCE_CODE).setWorldExtent(PEIRCE_WORLD_EXTENT)

get(TRIPTYCHIAL_CODE).setExtent(PEIRCE_EXTENT)
get(TRIPTYCHIAL_CODE).setWorldExtent(PEIRCE_WORLD_EXTENT)
get(TRIPTYCHIAL_CODE).setGlobal(true)

get('EPSG:3031').setExtent([-4898635.244666592,-4898635.24466659,4898635.24466659,4898635.244666592])
get('EPSG:3031').setWorldExtent([-180,-90,180,-50])
