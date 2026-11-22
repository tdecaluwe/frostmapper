export const TRIPTYCHIAL_CODE='FROST:TRIPTYCHIAL'
export const TRIPTYCHIAL_DEFINITION='+proj=pipeline +step +proj=ob_tran +o_proj=peirce_q +o_lat_p=-45 +o_lon_p=45 +o_type=horizontal +o_scrollx=-0.25 +step +proj=affine +s11=-1 +s12=0 +s21=0 +s22=-1'
export const PROJECTION_STRINGS=Object.freeze({
 'EPSG:3857':'+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
 'EPSG:3031':'+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs',
 'EPSG:3035':'+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs',
 'EPSG:PEIRCE':'+proj=peirce_q +lon_0=25 +shape=horizontal +units=m +no_defs',
 [TRIPTYCHIAL_CODE]:TRIPTYCHIAL_DEFINITION
})
