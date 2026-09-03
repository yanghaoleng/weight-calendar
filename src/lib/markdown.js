import {
  calendarCells,
  formatWeight,
  normalizeWeightUnit,
  parseDateKey,
  recordsWithDeltas,
  weightUnitSymbol,
} from "./calendar.js";
import { DEFAULT_LANGUAGE, formatLocaleMonth, normalizeLanguage, tFor } from "./i18n.js";

export function makeMarkdownExport(data, { demo, todayKey, toolUrl, passcode, language = DEFAULT_LANGUAGE, unit }) {
  const locale = normalizeLanguage(language);
  const t = (key, values) => tFor(locale, key, values);
  const selectedUnit = normalizeWeightUnit(unit || data.account.unit);
  const unitSymbol = weightUnitSymbol(selectedUnit);
  const unitLabelKey = { kg: "unitKg", jin: "unitJin", lb: "unitLb", st: "unitSt" }[selectedUnit];
  const labelSeparator = locale.startsWith("zh") ? "：" : ": ";
  const fieldSeparator = locale.startsWith("zh") ? "；" : "; ";
  const sortedRecords = recordsWithDeltas(data.records);
  const recordMap = new Map(sortedRecords.map((record) => [record.date, record]));
  const months = new Set(sortedRecords.map((record) => record.date.slice(0, 7)));
  if (data.account.initialDate) months.add(data.account.initialDate.slice(0, 7));
  if (months.size === 0) months.add(todayKey.slice(0, 7));

  const title = demo
    ? t("exportTitleDemo")
    : data.account.displayName
      ? t("exportTitleNamed", { name: data.account.displayName.replaceAll("|", "\\|") })
      : t("exportTitleMine");
  const exportPasscode = demo ? t("demoNoPasscode") : passcode || t("unreadable");
  const lines = [
    `# ${title}`,
    "",
    `- ${t("exportDate")}${labelSeparator}${todayKey}`,
    `- ${t("toolUrl")}${labelSeparator}${toolUrl}${fieldSeparator}${t("loginPasscode")}${labelSeparator}${exportPasscode}`,
    `- ${t("initialDate")}${labelSeparator}${data.account.initialDate || t("notSet")}`,
    `- ${t("initialWeight")}${labelSeparator}${data.account.initialWeightGrams ? `${formatWeight(data.account.initialWeightGrams, selectedUnit)} ${unitSymbol}` : t("notSet")}`,
    `- ${t("unit")}${labelSeparator}${t(unitLabelKey)} (${unitSymbol})`,
    "",
  ];

  [...months].sort().forEach((monthKey) => {
    const monthDate = parseDateKey(`${monthKey}-01`);
    const monthCells = calendarCells(monthDate);
    lines.push(`## ${formatLocaleMonth(monthDate, locale)}`, "", `| ${t("weekdays").join(" | ")} |`, "| --- | --- | --- | --- | --- | --- | --- |");
    for (let index = 0; index < monthCells.length; index += 7) {
      const week = monthCells.slice(index, index + 7).map((cell) => {
        if (!cell) return "";
        const record = recordMap.get(cell.key);
        if (!record) return String(cell.day).padStart(2, "0");
        const delta = record.deltaGrams;
        const change = delta > 0
          ? `↑${formatWeight(delta, selectedUnit)} ${unitSymbol}`
          : delta < 0
            ? `↓${formatWeight(Math.abs(delta), selectedUnit)} ${unitSymbol}`
            : t("start");
        return `${String(cell.day).padStart(2, "0")} · ${formatWeight(record.weightGrams, selectedUnit)} ${unitSymbol} · ${change}`;
      });
      lines.push(`| ${week.join(" | ")} |`);
    }
    lines.push("");
  });

  lines.push(t("increaseNote"), "");
  return lines.join("\n");
}
