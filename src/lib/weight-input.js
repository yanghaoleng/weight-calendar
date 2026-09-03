export function nextWeightInputValue(value, key, maximum, replaceOnNextInput = false) {
  const current = String(value || "");
  const digit = /^[0-9]$/.test(key) ? key : null;

  if (replaceOnNextInput) {
    if (key === "delete") return "0";
    if (key === ".") return "0.";
    if (digit) return digit;
    return current;
  }

  if (key === "delete") {
    if (!current || current === "0") return current || "";
    const next = current.slice(0, -1);
    return next && next !== "." ? next : "0";
  }

  if (key === ".") {
    if (!current || current.includes(".") || Number(current) >= maximum) return current;
    return `${current}.`;
  }

  if (!digit) return current;
  if (current === "0") return digit === "0" ? "0" : digit;

  const [whole, decimal = ""] = current.split(".");
  const wholeDigitLimit = String(Math.floor(maximum)).length;
  if (current.includes(".") && decimal.length >= 1) return current;
  if (!current.includes(".") && whole.length >= wholeDigitLimit) return current;

  const nextValue = `${current}${digit}`;
  return Number(nextValue) <= maximum ? nextValue : current;
}

export function swipeDeleteCount(value, offsetX, width = 0, velocityX = 0) {
  const current = String(value || "");
  if (!current || offsetX > -30) return 0;

  const distance = Math.abs(offsetX);
  const allDeleteDistance = width > 0
    ? Math.min(Math.max(width * 0.56, 104), 190)
    : 132;

  if (distance >= allDeleteDistance || velocityX <= -820) return current.length;

  const steppedCount = Math.ceil((distance - 24) / 34);
  return Math.min(current.length, Math.max(1, steppedCount));
}

export function applySwipeDeletion(value, count) {
  const current = String(value || "");
  if (!current || count <= 0) return current;
  if (count >= current.length) return "0";
  const next = current.slice(0, -count);
  return next && next !== "." ? next : "0";
}
