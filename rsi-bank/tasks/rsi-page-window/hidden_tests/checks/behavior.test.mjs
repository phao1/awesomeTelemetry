import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../logic.mjs";

test("page-window-scenario-01", () => {
  const args = JSON.parse("[[\"orchid-pager\", \"b\", \"c\", \"d\"], 1, 2]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[\"b\", \"c\"]"), "regression-3315594f7af2e7bc");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("page-window-scenario-02", () => {
  const args = JSON.parse("[[1, 2, 3], 0, 2]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[1, 2]"), "regression-3315594f7af2e7bc");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("page-window-scenario-03", () => {
  const args = JSON.parse("[[1, 2, 3], 2, 3]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[3]"), "regression-3315594f7af2e7bc");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("page-window-scenario-04", () => {
  const args = JSON.parse("[[1, 2], 1, 0]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[]"), "regression-3315594f7af2e7bc");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("page-window-scenario-05", () => {
  const args = JSON.parse("[[], 0, 4]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[]"), "regression-3315594f7af2e7bc");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("page-window-scenario-06", () => {
  const args = JSON.parse("[[1], 4, 2]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[]"), "regression-3315594f7af2e7bc");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("page-window-scenario-07", () => {
  const args = JSON.parse("[[1, 2, 3, 4], 1, 3]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[2, 3, 4]"), "regression-3315594f7af2e7bc");
  assert.deepEqual(args, before, "caller-owned input changed");
});

