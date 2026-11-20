import Zoom from 'ol/control/Zoom.js'
import Rotate from 'ol/control/Rotate.js'
import Attribution from 'ol/control/Attribution.js'

export function attachNavigation(map){
 const target=document.querySelector('#navigation')
 map.getControls().clear()
 map.addControl(new Zoom({target}))
 map.addControl(new Rotate({target,autoHide:false,label:'↑',tipLabel:'Reset rotation to north'}))
 map.addControl(new Attribution({target,collapsible:true,collapsed:true,label:'©',collapseLabel:'©',tipLabel:'Map credits'}))
 for(const button of target.querySelectorAll('button'))button.setAttribute('aria-label',button.title)
}
