import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../logic.mjs";

test("range-union-scenario-01", () => {
  const args = JSON.parse("[[[5, 8], [1, 3], [3, 6]]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[[1, 8]]"), "regression-fd26bff21f7476a9");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("range-union-scenario-02", () => {
  const args = JSON.parse("[[[1, 10], [2, 3]]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[[1, 10]]"), "regression-fd26bff21f7476a9");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("range-union-scenario-03", () => {
  const args = JSON.parse("[[]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[]"), "regression-fd26bff21f7476a9");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("range-union-scenario-04", () => {
  const args = JSON.parse("[[[0, 0], [0, 1]]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[[0, 1]]"), "regression-fd26bff21f7476a9");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("range-union-scenario-05", () => {
  const args = JSON.parse("[[[-5, -2], [-1, 2]]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[[-5, -2], [-1, 2]]"), "regression-fd26bff21f7476a9");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("range-union-scenario-06", () => {
  const args = JSON.parse("[[[2, 4], [2, 7], [9, 10]]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[[2, 7], [9, 10]]"), "regression-fd26bff21f7476a9");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("range-union-scenario-07", () => {
  const args = JSON.parse("[[[1, 2]]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[[1, 2]]"), "regression-fd26bff21f7476a9");
  assert.deepEqual(args, before, "caller-owned input changed");
});

