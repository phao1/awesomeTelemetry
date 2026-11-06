import { matches, score } from "./matcher.mjs";
export function evaluate(routes, path) {
  return routes.find(r => matches(r.path, path))?.name ?? null;
}
