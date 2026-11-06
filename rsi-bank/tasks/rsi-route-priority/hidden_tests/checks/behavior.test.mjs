import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../logic.mjs";

test("route-priority-scenario-01", () => {
  const args = JSON.parse("[[{\"path\": \"/:id\", \"name\": \"generic\"}, {\"path\": \"/settings\", \"name\": \"indigo-dispatch\"}], \"/settings\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("\"indigo-dispatch\""), "regression-64180c632dc42625");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("route-priority-scenario-02", () => {
  const args = JSON.parse("[[{\"path\": \"/a/:x\", \"name\": \"capture\"}], \"/a/\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("null"), "regression-64180c632dc42625");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("route-priority-scenario-03", () => {
  const args = JSON.parse("[[{\"path\": \"/a/:x\", \"name\": \"capture\"}], \"/a/b/c\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("null"), "regression-64180c632dc42625");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("route-priority-scenario-04", () => {
  const args = JSON.parse("[[{\"path\": \"/:x/b\", \"name\": \"first\"}, {\"path\": \"/a/:y\", \"name\": \"second\"}], \"/a/b\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("\"first\""), "regression-64180c632dc42625");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("route-priority-scenario-05", () => {
  const args = JSON.parse("[[{\"path\": \"/\", \"name\": \"home\"}], \"/\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("\"home\""), "regression-64180c632dc42625");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("route-priority-scenario-06", () => {
  const args = JSON.parse("[[{\"path\": \"/a/:x/c\", \"name\": \"capture\"}], \"/a//c\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("null"), "regression-64180c632dc42625");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("route-priority-scenario-07", () => {
  const args = JSON.parse("[[{\"path\": \"/a/:x\", \"name\": \"capture\"}], \"/a/b/\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("\"capture\""), "regression-64180c632dc42625");
  assert.deepEqual(args, before, "caller-owned input changed");
});

test("route-priority-scenario-08", () => {
  const args = JSON.parse("[[], \"/a\"]");
  const before = structuredClone(args);
  assert.deepEqual(evaluate(...args), JSON.parse("null"), "regression-64180c632dc42625");
  assert.deepEqual(args, before, "caller-owned input changed");
});

