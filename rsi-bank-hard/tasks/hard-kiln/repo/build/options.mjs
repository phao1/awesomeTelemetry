export function options(input={}) {
  const value={version:'v1',separator:'',aliases:{},...input};
  if(typeof value.version!=='string'||typeof value.separator!=='string')throw new Error('options');
  if(!value.aliases||Array.isArray(value.aliases)||typeof value.aliases!=='object')throw new Error('aliases');
  for(const [key,path] of Object.entries(value.aliases))if(!key||typeof path!=='string')throw new Error('alias');
  return structuredClone(value);
}
