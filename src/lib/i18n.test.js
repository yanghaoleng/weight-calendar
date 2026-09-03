import test from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES, normalizeLanguage, tFor } from "./i18n.js";

test("all six supported languages provide localized core navigation", () => {
  assert.deepEqual(LANGUAGES.map((item) => item.id), ["zh-CN", "zh-HK", "zh-TW", "ja", "en", "ko"]);
  for (const language of LANGUAGES.map((item) => item.id)) {
    for (const key of ["appName", "settings", "aboutPrivacy", "privacy", "language", "openMyCalendar", "fontHumanistLabel", "fontCuteLabel", "fontLightLabel", "accountDeleted", "productHighlights", "highlightSync", "jennieThanks", "changePasscode", "newPasscodeTitle", "passcodeChanged", "passcodeDigitsUnit", "switchPasscodeLength"]) {
      assert.notEqual(tFor(language, key), key);
    }
  }
  assert.equal(tFor("ja", "settings"), "設定");
  assert.equal(tFor("ko", "language"), "언어");
  assert.match(tFor("zh-HK", "privacy"), /私隱/);
  assert.match(tFor("zh-TW", "privacy"), /隱私/);
  assert.equal(tFor("zh-CN", "switchPasscodeLength", { count: 6 }), "切换为 6 位密码");
  assert.equal(tFor("en", "pinKeypad", { count: 4 }), "4-digit passcode keypad");
});

test("browser language variants normalize to supported locales", () => {
  assert.equal(normalizeLanguage("zh-Hant-HK"), "zh-HK");
  assert.equal(normalizeLanguage("zh-Hant"), "zh-TW");
  assert.equal(normalizeLanguage("ja-JP"), "ja");
  assert.equal(normalizeLanguage("ko-KR"), "ko");
  assert.equal(normalizeLanguage("en-US"), "en");
});
