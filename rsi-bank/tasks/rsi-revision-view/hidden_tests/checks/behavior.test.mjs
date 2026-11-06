import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../logic.mjs";

test("revision-view-scenario-01", () => {
  const args = JSON.parse("[[]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("{}"), "regression-ce2e56bec9a1a705");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("revision-view-scenario-02", () => {
  const args = JSON.parse("[[{\"key\": \"saffron-document\", \"revision\": 2, \"deleted\": true, \"value\": \"gone\"}, {\"key\": \"saffron-document\", \"revision\": 1, \"deleted\": false, \"value\": \"old\"}]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("{}"), "regression-ce2e56bec9a1a705");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("revision-view-scenario-03", () => {
  const args = JSON.parse("[[{\"key\": \"a\", \"revision\": 2, \"deleted\": false, \"value\": \"new\"}, {\"key\": \"a\", \"revision\": 1, \"deleted\": true, \"value\": \"gone\"}]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("{\"a\": \"new\"}"), "regression-ce2e56bec9a1a705");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("revision-view-scenario-04", () => {
  const args = JSON.parse("[[{\"key\": \"a\", \"revision\": 1, \"deleted\": false, \"value\": \"first\"}, {\"key\": \"a\", \"revision\": 1, \"deleted\": false, \"value\": \"second\"}]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("{\"a\": \"first\"}"), "regression-ce2e56bec9a1a705");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("revision-view-scenario-05", () => {
  const args = JSON.parse("[[{\"key\": \"a\", \"revision\": 1, \"deleted\": false, \"value\": \"live\"}, {\"key\": \"a\", \"revision\": 1, \"deleted\": true, \"value\": \"gone\"}]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("{}"), "regression-ce2e56bec9a1a705");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("revision-view-scenario-06", () => {
  const args = JSON.parse("[[{\"key\": \"a\", \"revision\": 1, \"deleted\": true, \"value\": \"gone\"}, {\"key\": \"a\", \"revision\": 1, \"deleted\": false, \"value\": \"late\"}]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("{}"), "regression-ce2e56bec9a1a705");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("revision-view-scenario-07", () => {
  const args = JSON.parse("[[{\"key\": \"a\", \"revision\": 1, \"deleted\": true, \"value\": \"gone\"}, {\"key\": \"a\", \"revision\": 2, \"deleted\": false, \"value\": \"reborn\"}]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("{\"a\": \"reborn\"}"), "regression-ce2e56bec9a1a705");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("revision-view-scenario-08", () => {
  const args = JSON.parse("[[{\"key\": \"__proto__\", \"revision\": 0, \"deleted\": false, \"value\": \"safe\"}]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("{\"__proto__\": \"safe\"}"), "regression-ce2e56bec9a1a705");
  assert.deepEqual(args, before, "caller-owned input changed");
});

