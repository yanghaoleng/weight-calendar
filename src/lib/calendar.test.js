import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarCells,
  recordsWithDeltas,
  parseDateKey,
  toDateKey,
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
