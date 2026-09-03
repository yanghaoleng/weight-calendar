import test from "node:test";
import assert from "node:assert/strict";
import { makeMarkdownExport } from "./markdown.js";

test("Markdown export records the tool URL and account passcode in its header", () => {
  const markdown = makeMarkdownExport({
    account: {
      displayName: "小沈",
      initialDate: "2026-08-01",
      initialWeightGrams: 61200,
    },
    records: [
      { date: "2026-08-01", weightGrams: 61200 },
    ],
  }, {
    demo: false,
    todayKey: "2026-09-03",
    toolUrl: "https://wcal.mikeywa.site/",
    passcode: "173205",
  });

  assert.match(
    markdown,
    /- 工具网址：https:\/\/wcal\.mikeywa\.site\/；登录密码：173205/,
  );
  assert.ok(markdown.indexOf("工具网址") < markdown.indexOf("初始日期"));
});

test("Markdown export follows the selected language", () => {
  const markdown = makeMarkdownExport({
    account: { displayName: "Mina", initialDate: "2026-08-01", initialWeightGrams: 61200 },
    records: [{ date: "2026-08-01", weightGrams: 61200 }],
  }, {
    demo: false,
    todayKey: "2026-09-03",
    toolUrl: "https://wcal.mikeywa.site/",
    passcode: "173205",
    language: "en",
  });

  assert.match(markdown, /^# Mina's Weight Calendar/m);
  assert.match(markdown, /\| Mon \| Tue \| Wed \|/);
  assert.match(markdown, /Tool URL: https:\/\/wcal\.mikeywa\.site\/; Login passcode: 173205/);
});

test("Markdown export follows the selected weight unit", () => {
  const markdown = makeMarkdownExport({
    account: { displayName: "Mina", initialDate: "2026-08-01", initialWeightGrams: 60000 },
    records: [
      { date: "2026-08-01", weightGrams: 60000 },
      { date: "2026-08-02", weightGrams: 60454 },
    ],
  }, {
    demo: false,
    todayKey: "2026-09-03",
    toolUrl: "https://wcal.mikeywa.site/",
    passcode: "173205",
    language: "en",
    unit: "lb",
  });

  assert.match(markdown, /Starting weight: 132\.3 lb/);
  assert.match(markdown, /Weight unit: Pounds \(lb\)/);
  assert.match(markdown, /133\.3 lb · ↑1\.0 lb/);
});
