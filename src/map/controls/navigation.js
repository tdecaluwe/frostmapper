import Zoom from 'ol/control/Zoom.js'
import Rotate from 'ol/control/Rotate.js'
import Attribution from 'ol/control/Attribution.js'

export function attachNavigation(map){
 const target=document.querySelector('#navigation')
 map.getControls().clear()
 target.prepend(document.querySelector('aside'))
 map.addControl(new Attribution({target,collapsible:true,collapsed:true,label:'©',collapseLabel:'©',tipLabel:'Map credits'}))
 map.addControl(new Rotate({target,autoHide:false,label:'↑',tipLabel:'Reset rotation to north'}))
 map.addControl(new Zoom({target}))
 for(const button of target.querySelectorAll('button'))button.setAttribute('aria-label',button.title)
}
