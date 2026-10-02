import test from "node:test";
import assert from "node:assert/strict";
import { total } from "../src/calc.ts";

test("total sums values", () => {
  assert.equal(total([1, 2, 3]), 6);
});
