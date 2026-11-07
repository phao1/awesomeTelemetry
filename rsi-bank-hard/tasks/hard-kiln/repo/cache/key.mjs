import {digest} from '../digest.mjs';
export function identity(node,dependencies,options) {
  return digest([options.version,node.path,node.source,options.separator]);
}
