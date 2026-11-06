import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../logic.mjs";

test("query-multimap-scenario-01", () => {
  const args = JSON.parse("[\"?tag=azalea-filter&tag=b\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("{\"tag\": [\"azalea-filter\", \"b\"]}"), "regression-1cc5849e7d008022");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("query-multimap-scenario-02", () => {
  const args = JSON.parse("[\"empty=&flag\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("{\"empty\": [\"\"], \"flag\": [\"\"]}"), "regression-1cc5849e7d008022");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("query-multimap-scenario-03", () => {
  const args = JSON.parse("[\"\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("{}"), "regression-1cc5849e7d008022");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("query-multimap-scenario-04", () => {
  const args = JSON.parse("[\"x=a+b&x=%2B\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("{\"x\": [\"a b\", \"+\"]}"), "regression-1cc5849e7d008022");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("query-multimap-scenario-05", () => {
  const args = JSON.parse("[\"__proto__=safe&constructor=ok\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("{\"__proto__\": [\"safe\"], \"constructor\": [\"ok\"]}"), "regression-1cc5849e7d008022");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("query-multimap-scenario-06", () => {
  const args = JSON.parse("[\"=anonymous\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("{\"\": [\"anonymous\"]}"), "regression-1cc5849e7d008022");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("query-multimap-scenario-07", () => {
  const args = JSON.parse("[\"%61=one&a=two\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("{\"a\": [\"one\", \"two\"]}"), "regression-1cc5849e7d008022");
  assert.deepEqual(args, before, "caller-owned input changed");
});

