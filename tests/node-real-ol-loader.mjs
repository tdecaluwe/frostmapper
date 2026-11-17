import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {resolve as resolvePath} from 'node:path'
const root=process.env.FROST_TEST_NODE_MODULES||resolvePath('tests/node-deps/node_modules')
const require=createRequire(resolvePath(root,'../package.json'))
export function resolve(specifier,context,next){
 if(specifier.startsWith('ol/')||specifier==='proj4'||specifier==='https://esm.sh/proj4@2.19.10'||specifier==='https://esm.sh/ol@10.6.1/proj.js'||specifier==='https://esm.sh/ol@10.6.1/proj/proj4.js'){
  const normalized=specifier==='https://esm.sh/ol@10.6.1/proj.js'?'ol/proj.js':specifier==='https://esm.sh/ol@10.6.1/proj/proj4.js'?'ol/proj/proj4.js':specifier==='https://esm.sh/proj4@2.19.10'?'proj4':specifier
  const [name,query]=normalized.split('?')
  const url=pathToFileURL(require.resolve(name)).href+(query?'?'+query:'')
  return next(url,context)
 }
 return next(specifier,context)
}
