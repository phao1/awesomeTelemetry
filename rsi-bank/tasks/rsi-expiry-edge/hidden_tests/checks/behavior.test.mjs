import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../logic.mjs";

test("expiry-edge-scenario-01", () => {
  const args = JSON.parse("[3, 4, true]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("true"), "regression-2ab4c9f7c57d8ed7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("expiry-edge-scenario-02", () => {
  const args = JSON.parse("[4, 4, true]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("false"), "regression-2ab4c9f7c57d8ed7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("expiry-edge-scenario-03", () => {
  const args = JSON.parse("[5, 4, true]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("false"), "regression-2ab4c9f7c57d8ed7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("expiry-edge-scenario-04", () => {
  const args = JSON.parse("[3, 4, false]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("false"), "regression-2ab4c9f7c57d8ed7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("expiry-edge-scenario-05", () => {
  const args = JSON.parse("[0, 0, false]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("false"), "regression-2ab4c9f7c57d8ed7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("expiry-edge-scenario-06", () => {
  const args = JSON.parse("[-2, -1, true]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("true"), "regression-2ab4c9f7c57d8ed7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("expiry-edge-scenario-07", () => {
  const args = JSON.parse("[1.5, 1.5, true]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("false"), "regression-2ab4c9f7c57d8ed7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("expiry-edge-scenario-08", () => {
  const args = JSON.parse("[10, 3, false]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("false"), "regression-2ab4c9f7c57d8ed7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

