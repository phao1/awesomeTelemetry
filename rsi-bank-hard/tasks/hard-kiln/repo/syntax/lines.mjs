export function lines(text) {
  const out=[];let start=0;let number=1;
  for(let i=0;i<=text.length;i++) {
    if(i===text.length||text[i]==='\n') {
      let value=text.slice(start,i);
      if(value.endsWith('\r'))value=value.slice(0,-1);
      out.push({number,text:value});number++;start=i+1;
    }
  }
  return out;
}
export function quoted(text) {
  const value=text.trim();
  if(!value.startsWith('"')||!value.endsWith('"'))throw new Error('quoted string');
  const result=JSON.parse(value);
  if(typeof result!=='string')throw new Error('string');
  return result;
}
