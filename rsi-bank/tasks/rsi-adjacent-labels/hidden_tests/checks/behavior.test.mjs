import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../logic.mjs";

test("adjacent-labels-scenario-01", () => {
  const args = JSON.parse("[[\"velvet-breadcrumb\", \"velvet-breadcrumb\", \"x\", \"velvet-breadcrumb\"]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[\"velvet-breadcrumb\", \"x\", \"velvet-breadcrumb\"]"), "regression-738a20e04846c68d");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("adjacent-labels-scenario-02", () => {
  const args = JSON.parse("[[]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[]"), "regression-738a20e04846c68d");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("adjacent-labels-scenario-03", () => {
  const args = JSON.parse("[[\"\"]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[\"\"]"), "regression-738a20e04846c68d");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("adjacent-labels-scenario-04", () => {
  const args = JSON.parse("[[\"\", \"\"]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[\"\"]"), "regression-738a20e04846c68d");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("adjacent-labels-scenario-05", () => {
  const args = JSON.parse("[[\"a\", \"b\"]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[\"a\", \"b\"]"), "regression-738a20e04846c68d");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("adjacent-labels-scenario-06", () => {
  const args = JSON.parse("[[\"a\", \"a\", \"b\", \"b\"]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[\"a\", \"b\"]"), "regression-738a20e04846c68d");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("adjacent-labels-scenario-07", () => {
  const args = JSON.parse("[[\"a\", \"b\", \"a\"]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("[\"a\", \"b\", \"a\"]"), "regression-738a20e04846c68d");
  assert.deepEqual(args, before, "caller-owned input changed");
});

