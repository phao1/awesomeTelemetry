import { reserve, release } from "./inventory.mjs";
export function evaluate(initial, events) {
  const state = { available: initial, holds: new Map() };
  for (const e of events) {
    if (e.type === "reserve") reserve(state, e.id, e.qty);
    else release(state, e.id);
  }
  return state.available;
}
