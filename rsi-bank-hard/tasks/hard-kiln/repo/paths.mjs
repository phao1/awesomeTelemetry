export function normalize(path) {
  if (typeof path !== 'string' || path.startsWith('/')) throw new Error('relative path');
  const parts=[];
  for(const part of path.split('/')) {
    if(!part || part==='.') continue;
    if(part==='..') { if(!parts.length) throw new Error('escape');parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}
export function directory(path) { const parts=normalize(path).split('/');parts.pop();return parts.join('/'); }
export function join(base,path) { return normalize(base+'/'+path); }
export function extension(path) { const file=path.split('/').at(-1);const i=file.lastIndexOf('.');return i<0?'':file.slice(i); }
export function relative(base,path) {
  const a=normalize(base).split('/').filter(Boolean),b=normalize(path).split('/').filter(Boolean);
  let common=0;while(common<a.length&&a[common]===b[common])common++;
  return [...a.slice(common).map(()=> '..'),...b.slice(common)].join('/')||'.';
}
