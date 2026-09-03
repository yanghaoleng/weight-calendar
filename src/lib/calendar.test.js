import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarCells,
  formatWeight,
  maximumWeightInput,
  normalizeWeightUnit,
  recordsWithDeltas,
  parseDateKey,
  toDateKey,
  unitToGrams,
  weightUnitSymbol,
} from "./calendar.js";

test("calendar starts on Monday and keeps full weeks", () => {
  const cells = calendarCells(new Date(2026, 6, 1));
  assert.equal(cells.length, 35);
  assert.equal(cells[0], null);
  assert.equal(cells[1], null);
  assert.equal(cells[2].key, "2026-07-01");
  assert.equal(cells.filter(Boolean).at(-1).key, "2026-07-31");
});

test("record deltas always follow chronological order", () => {
  const result = recordsWithDeltas([
    { date: "2026-07-03", weightGrams: 59700 },
    { date: "2026-07-01", weightGrams: 61000 },
    { date: "2026-07-02", weightGrams: 59900 },
  ]);
  assert.deepEqual(
    result.map((item) => [item.date, item.deltaGrams]),
    [
      ["2026-07-01", 0],
      ["2026-07-02", -1100],
      ["2026-07-03", -200],
    ],
  );
});

test("date keys reject impossible dates", () => {
  assert.equal(toDateKey(new Date(2026, 8, 3)), "2026-09-03");
  assert.equal(parseDateKey("2026-02-30"), null);
  assert.equal(parseDateKey("hello"), null);
});

test("weight units convert from the same stored grams without changing the source data", () => {
  assert.equal(formatWeight(60000, "kg"), "60.0");
  assert.equal(formatWeight(60000, "jin"), "120.0");
  assert.equal(formatWeight(60000, "lb"), "132.3");
  assert.equal(formatWeight(60000, "st"), "9.4");
  assert.equal(unitToGrams(120, "jin"), 60000);
  assert.equal(unitToGrams(132.3, "lb"), 60010);
  assert.equal(weightUnitSymbol("lb"), "lb");
});

test("weight unit validation and input limits use kilograms as a safe fallback", () => {
  assert.equal(normalizeWeightUnit("unknown"), "kg");
  assert.equal(maximumWeightInput("kg"), 999);
  assert.equal(maximumWeightInput("jin"), 1998);
  assert.equal(maximumWeightInput("lb"), 2202.4);
  assert.equal(maximumWeightInput("st"), 157.3);
});
