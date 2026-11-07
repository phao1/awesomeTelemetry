import {lines,quoted} from './lines.mjs';
export function parse(text) {
  const imports=[];const operations=[];
  for(const row of lines(text)) {
    const line=row.text.trim();
    if(!line||line.startsWith('#'))continue;
    const at=line.indexOf(' ');
    const op=at<0?line:line.slice(0,at);
    const value=at<0?'':line.slice(at+1);
    if(op==='use')imports.push(quoted(value));
    else if(op==='text')operations.push({kind:'text',value:quoted(value),line:row.number});
    else if(op==='take') {
      const index=Number(value);
      if(!Number.isInteger(index)||index<0)throw new Error('dependency index');
      operations.push({kind:'take',index,line:row.number});
    } else if(['upper','lower','reverse','trim','unique'].includes(op)&&!value)operations.push({kind:op,line:row.number});
    else if(op==='join')operations.push({kind:'join',value:quoted(value),line:row.number});
    else if(op==='repeat') {
      const count=Number(value);if(!Number.isInteger(count)||count<0||count>100)throw new Error('repeat');
      operations.push({kind:'repeat',count,line:row.number});
    } else throw new Error('unknown syntax at '+row.number);
  }
  for(const operation of operations)if(operation.kind==='take'&&operation.index>=imports.length)throw new Error('dependency index');
  return {imports,operations};
}
