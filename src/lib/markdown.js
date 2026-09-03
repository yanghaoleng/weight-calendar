import {
  calendarCells,
  formatKg,
  monthLabel,
  parseDateKey,
  recordsWithDeltas,
} from "./calendar.js";

export function makeMarkdownExport(data, { demo, todayKey, toolUrl, passcode }) {
  const sortedRecords = recordsWithDeltas(data.records);
  const recordMap = new Map(sortedRecords.map((record) => [record.date, record]));
  const months = new Set(sortedRecords.map((record) => record.date.slice(0, 7)));
  if (data.account.initialDate) months.add(data.account.initialDate.slice(0, 7));
  if (months.size === 0) months.add(todayKey.slice(0, 7));

  const title = demo
    ? "Demo 体重日历"
    : data.account.displayName
      ? `${data.account.displayName.replaceAll("|", "\\|")}的体重日历`
      : "我的体重日历";
  const exportPasscode = demo ? "Demo 无密码" : passcode || "无法读取";
  const lines = [
    `# ${title}`,
    "",
    `- 导出日期：${todayKey}`,
    `- 工具网址：${toolUrl}；登录密码：${exportPasscode}`,
    `- 初始日期：${data.account.initialDate || "未设置"}`,
    `- 初始体重：${data.account.initialWeightGrams ? `${formatKg(data.account.initialWeightGrams)} kg` : "未设置"}`,
    "",
  ];

  [...months].sort().forEach((monthKey) => {
    const monthDate = parseDateKey(`${monthKey}-01`);
    const monthCells = calendarCells(monthDate);
    lines.push(`## ${monthLabel(monthDate)}`, "", "| 一 | 二 | 三 | 四 | 五 | 六 | 日 |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (let index = 0; index < monthCells.length; index += 7) {
      const week = monthCells.slice(index, index + 7).map((cell) => {
        if (!cell) return "";
        const record = recordMap.get(cell.key);
        if (!record) return String(cell.day).padStart(2, "0");
        const delta = record.deltaGrams;
        const change = delta > 0
          ? `↑${formatKg(delta)}kg`
          : delta < 0
            ? `↓${formatKg(Math.abs(delta))}kg`
            : "起点";
        return `${String(cell.day).padStart(2, "0")} · ${formatKg(record.weightGrams)}kg · ${change}`;
      });
      lines.push(`| ${week.join(" | ")} |`);
    }
    lines.push("");
  });

  lines.push("↑ 表示增加，↓ 表示减少；差值均相对于上一次记录。", "");
  return lines.join("\n");
}
