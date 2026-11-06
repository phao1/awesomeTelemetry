import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../logic.mjs";

test("stock-reservations-scenario-01", () => {
  const args = JSON.parse("[5, [{\"type\": \"reserve\", \"id\": \"cobalt-hold\", \"qty\": 3}, {\"type\": \"reserve\", \"id\": \"cobalt-hold\", \"qty\": 3}]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("2"), "regression-36fb2b88ee76a2e7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("stock-reservations-scenario-02", () => {
  const args = JSON.parse("[5, [{\"type\": \"reserve\", \"id\": \"a\", \"qty\": 6}, {\"type\": \"release\", \"id\": \"a\"}]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("5"), "regression-36fb2b88ee76a2e7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("stock-reservations-scenario-03", () => {
  const args = JSON.parse("[5, [{\"type\": \"reserve\", \"id\": \"a\", \"qty\": 5}, {\"type\": \"release\", \"id\": \"a\"}, {\"type\": \"release\", \"id\": \"a\"}]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("5"), "regression-36fb2b88ee76a2e7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("stock-reservations-scenario-04", () => {
  const args = JSON.parse("[5, [{\"type\": \"release\", \"id\": \"none\"}]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("5"), "regression-36fb2b88ee76a2e7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("stock-reservations-scenario-05", () => {
  const args = JSON.parse("[5, [{\"type\": \"reserve\", \"id\": \"a\", \"qty\": 2}, {\"type\": \"release\", \"id\": \"a\"}, {\"type\": \"reserve\", \"id\": \"a\", \"qty\": 4}]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("1"), "regression-36fb2b88ee76a2e7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("stock-reservations-scenario-06", () => {
  const args = JSON.parse("[0, []]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("0"), "regression-36fb2b88ee76a2e7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("stock-reservations-scenario-07", () => {
  const args = JSON.parse("[5, [{\"type\": \"reserve\", \"id\": \"a\", \"qty\": 5}]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("0"), "regression-36fb2b88ee76a2e7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("stock-reservations-scenario-08", () => {
  const args = JSON.parse("[5, [{\"type\": \"reserve\", \"id\": \"a\", \"qty\": 2}, {\"type\": \"touch\", \"id\": \"a\"}]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("3"), "regression-36fb2b88ee76a2e7");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("stock-reservations-scenario-09", () => {
  const args = JSON.parse("[5, [{\"type\": \"reserve\", \"id\": \"tiny\", \"qty\": 1}, {\"type\": \"reserve\", \"id\": \"tiny\", \"qty\": 1}]]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("4"), "regression-36fb2b88ee76a2e7");
  assert.deepEqual(args, before, "caller-owned input changed");
});
