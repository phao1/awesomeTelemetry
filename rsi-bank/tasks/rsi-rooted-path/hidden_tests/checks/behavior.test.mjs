import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../logic.mjs";

test("rooted-path-scenario-01", () => {
  const args = JSON.parse("[\"/juniper-archive/./a/../b/\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("\"/juniper-archive/b\""), "regression-87e1b771d9118b96");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("rooted-path-scenario-02", () => {
  const args = JSON.parse("[\"../../a\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("\"/a\""), "regression-87e1b771d9118b96");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("rooted-path-scenario-03", () => {
  const args = JSON.parse("[\"\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("\"/\""), "regression-87e1b771d9118b96");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("rooted-path-scenario-04", () => {
  const args = JSON.parse("[\"/\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("\"/\""), "regression-87e1b771d9118b96");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("rooted-path-scenario-05", () => {
  const args = JSON.parse("[\"a//b/\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("\"/a/b\""), "regression-87e1b771d9118b96");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("rooted-path-scenario-06", () => {
  const args = JSON.parse("[\"a/../../\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("\"/\""), "regression-87e1b771d9118b96");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("rooted-path-scenario-07", () => {
  const args = JSON.parse("[\".../x\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("\"/.../x\""), "regression-87e1b771d9118b96");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("rooted-path-scenario-08", () => {
  const args = JSON.parse("[\"a/./b\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("\"/a/b\""), "regression-87e1b771d9118b96");
  assert.deepEqual(args, before, "caller-owned input changed");
});

