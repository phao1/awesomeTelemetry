import { newer } from "./revision.mjs";
export function evaluate(events) {
  const records = new Map();
  for (const e of events) {
    if (e.deleted) records.delete(e.key);
    else if (newer(e, records.get(e.key))) records.set(e.key, e);
  }
  return Object.fromEntries([...records].map(([key, e]) => [key, e.value]));
}
