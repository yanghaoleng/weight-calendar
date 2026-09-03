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
