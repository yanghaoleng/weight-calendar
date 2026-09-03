const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateKey(value) {
  if (!DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(date) {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function calendarCells(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];

  for (let index = 0; index < mondayOffset; index += 1) {
    cells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    cells.push({ date, key: toDateKey(date), day });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function recordsWithDeltas(records) {
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((record, index) => ({
    ...record,
    deltaGrams: index === 0 ? 0 : record.weightGrams - sorted[index - 1].weightGrams,
  }));
}

export function formatKg(grams) {
  return (grams / 1000).toFixed(1);
}

const UNIT_GRAMS = {
  kg: 1000,
  jin: 500,
  lb: 453.59237,
  st: 6350.29318,
};

export function normalizeWeightUnit(unit) {
  return Object.hasOwn(UNIT_GRAMS, unit) ? unit : "kg";
}

export function weightUnitSymbol(unit) {
  return { kg: "kg", jin: "斤", lb: "lb", st: "st" }[normalizeWeightUnit(unit)];
}

export function gramsToUnit(grams, unit = "kg") {
  return grams / UNIT_GRAMS[normalizeWeightUnit(unit)];
}

export function unitToGrams(value, unit = "kg") {
  return Math.round(Number(value) * UNIT_GRAMS[normalizeWeightUnit(unit)]);
}

export function formatWeight(grams, unit = "kg") {
  const rounded = gramsToUnit(grams, unit).toFixed(1);
  return rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
}

export function maximumWeightInput(unit = "kg") {
  return Math.floor((999000 / UNIT_GRAMS[normalizeWeightUnit(unit)]) * 10) / 10;
}

export function isMonthAfter(left, right) {
  return monthKey(left) > monthKey(right);
}
