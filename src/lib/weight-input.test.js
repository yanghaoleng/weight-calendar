import test from "node:test";
import assert from "node:assert/strict";
import {
  applySwipeDeletion,
  nextWeightInputValue,
  swipeDeleteCount,
} from "./weight-input.js";

test("weight keypad deletion reaches an explicit zero value", () => {
  assert.equal(nextWeightInputValue("6", "delete", 999), "0");
  assert.equal(nextWeightInputValue("60", "delete", 999), "6");
  assert.equal(nextWeightInputValue("0", "delete", 999), "0");
  assert.equal(nextWeightInputValue("64.2", "delete", 999), "64.");
});

test("weight keypad replaces existing values and avoids leading zeroes", () => {
  assert.equal(nextWeightInputValue("64.2", "delete", 999, true), "0");
  assert.equal(nextWeightInputValue("64.2", "5", 999, true), "5");
  assert.equal(nextWeightInputValue("0", "5", 999), "5");
  assert.equal(nextWeightInputValue("0", "0", 999), "0");
});

test("weight swipe can delete a decimal value in one gesture", () => {
  assert.equal(swipeDeleteCount("64.2", -40, 220), 1);
  assert.equal(swipeDeleteCount("64.2", -136, 220), 4);
  assert.equal(applySwipeDeletion("64.2", 4), "0");
});

test("fast left swipe deletes the whole visible value", () => {
  assert.equal(swipeDeleteCount("118.6", -42, 240, -900), 5);
  assert.equal(applySwipeDeletion("118.6", 5), "0");
});
