import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../logic.mjs";

test("retry-budget-scenario-01", () => {
  const args = JSON.parse("[2, 0, 20, 30]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("2"), "regression-13780771c2cc4549");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("retry-budget-scenario-02", () => {
  const args = JSON.parse("[2, 3, 20, 30]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("16"), "regression-13780771c2cc4549");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("retry-budget-scenario-03", () => {
  const args = JSON.parse("[2, 4, 20, 30]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("20"), "regression-13780771c2cc4549");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("retry-budget-scenario-04", () => {
  const args = JSON.parse("[2, 4, 20, 7]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("7"), "regression-13780771c2cc4549");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("retry-budget-scenario-05", () => {
  const args = JSON.parse("[0, 2048, 20, 30]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("0"), "regression-13780771c2cc4549");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("retry-budget-scenario-06", () => {
  const args = JSON.parse("[2, 2048, 20, 30]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("20"), "regression-13780771c2cc4549");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("retry-budget-scenario-07", () => {
  const args = JSON.parse("[3, 1, 0, 30]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("0"), "regression-13780771c2cc4549");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("retry-budget-scenario-08", () => {
  const args = JSON.parse("[1.5, 1, 10, 10]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("3"), "regression-13780771c2cc4549");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("retry-budget-scenario-09", () => {
  const args = JSON.parse("[1, 0, 2, 0]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("0"), "regression-13780771c2cc4549");
  assert.deepEqual(args, before, "caller-owned input changed");
});

