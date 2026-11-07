import { normalize,directory,join } from '../paths.mjs';
export function resolveImport(owner,request,aliases={}) {
  if(request.startsWith('.')) return join(directory(owner),request);
  for(const [alias,path] of Object.entries(aliases)) {
    if(request.startsWith(alias)) return normalize(path+request.slice(alias.length));
  }
  return normalize(request);
}
