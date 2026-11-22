// Projection registry for module workers. Import maps aren't available inside
// workers, so dependencies use the same pinned CDN modules as index.html.
import proj4 from 'https://esm.sh/proj4@2.19.10'
import {register} from 'https://esm.sh/ol@10.6.1/proj/proj4.js'
import {get} from 'https://esm.sh/ol@10.6.1/proj.js'
import {registerOblique} from './ob-tran.js'
import {registerPeirce,registerAffine,registerPipeline,definePipeline,PEIRCE_CODE,PEIRCE_EXTENT,PEIRCE_WORLD_EXTENT} from './peirce.js'
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

export {get}

get('EPSG:3031').setExtent([-4898635.244666592,-4898635.24466659,4898635.24466659,4898635.244666592])
get('EPSG:3031').setWorldExtent([-180,-90,180,-50])
