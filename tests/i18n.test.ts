import { expect, test } from "bun:test";
import { dicts, pickLang } from "../hooks/useI18n";

test("pickLang chooses Chinese when browser prefers zh", () => {
  expect(pickLang(["zh-CN", "en-US"], "en-US")).toBe("zh");
  expect(pickLang(["en-US", "zh-TW"], "en-US")).toBe("zh");
});

test("pickLang falls back to English for non-Chinese locales", () => {
  expect(pickLang(["fr-FR", "ja-JP"], "fr-FR")).toBe("en");
  expect(pickLang(undefined, undefined)).toBe("en");
});

test("dictionaries expose localized copy", () => {
  expect(dicts.en.app.welcome).toBe("Welcome to Aura");
  expect(dicts.zh.app.welcome).toBe("欢迎来到 Aura");
  expect(dicts.en.list.songs(2)).toBe("2 Songs");
  expect(dicts.zh.list.songs(2)).toBe("2 首歌曲");
  expect(dicts.zh.app.importOk(3)).toBe("已成功导入 3 首歌曲");
});
