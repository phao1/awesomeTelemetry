export function transform(kind,value) {
  switch(kind) {
    case 'upper':return value.toUpperCase();
    case 'lower':return value.toLowerCase();
    case 'reverse':return [...value].reverse().join('');
    case 'trim':return value.trim();
    case 'unique':return [...new Set([...value])].join('');
    default:throw new Error('transform');
  }
}
export function evaluate(operations,dependencies) {
  let stack=[];
  for(const operation of operations) {
    if(operation.kind==='text')stack.push(operation.value);
    else if(operation.kind==='take')stack.push(dependencies[operation.index].text);
    else if(operation.kind==='join')stack=[stack.join(operation.value)];
    else if(operation.kind==='repeat')stack=stack.map(value=>value.repeat(operation.count));
    else stack=stack.map(value=>transform(operation.kind,value));
  }
  return stack.join('');
}
