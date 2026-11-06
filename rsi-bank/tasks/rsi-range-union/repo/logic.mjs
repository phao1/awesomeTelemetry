export function evaluate(ranges) {
  const output = [];
  for (const range of ranges) {
    const last = output.at(-1);
    if (last && range[0] < last[1]) last[1] = range[1];
    else output.push([...range]);
  }
  return output;
}
