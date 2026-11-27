import Zoom from 'ol/control/Zoom.js'
import Rotate from 'ol/control/Rotate.js'
import Attribution from 'ol/control/Attribution.js'
import {StorageUsageControl,layerStorageDefinitions} from './storage-usage.js'

export function attachNavigation(map){
 const target=document.querySelector('#navigation')
 map.getControls().clear()
 target.prepend(document.querySelector('aside'))
 const attribution=new Attribution({target,collapsible:true,collapsed:true,label:'©',collapseLabel:'©',tipLabel:'Map credits'});map.addControl(attribution)
 map.addControl(new Rotate({target,autoHide:false,label:'↑',tipLabel:'Reset rotation to north'}))
 map.addControl(new Zoom({target}))
 const options=document.querySelector('#map-options'),storage=new StorageUsageControl({target,getLayers:()=>layerStorageDefinitions(map),onOpen:()=>{options.open=false;attribution.setCollapsed(true)}})
 options.addEventListener('toggle',()=>{if(options.open&&storage.opened)storage.close(false)})
 for(const button of target.querySelectorAll('button'))button.setAttribute('aria-label',button.title)
}
