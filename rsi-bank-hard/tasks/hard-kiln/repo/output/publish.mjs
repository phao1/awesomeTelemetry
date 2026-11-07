export function publish(previous,targets,built) {
  const next=new Map(previous);
  for(const target of targets)next.set(target.output,built.get(target.entry).text);
  return next;
}
