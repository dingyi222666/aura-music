import { expect, test } from "bun:test";
import { parseLyrics } from "@aura-music/lyrics/parser/index";
import { sparse } from "@aura-music/lyrics/parser/visibility";

test("instrumental notices and production credits collapse the lyric panel", () => {
  for (const text of [
    "[00:00.00]作曲: Supa7onyz\n[00:01.00]编曲: Supa7onyz\n[00:02.00]纯音乐，请欣赏",
    "[00:00.00]Composer: Example\n[00:01.00](Instrumental)",
    "[00:00.00]此歌曲为没有填词的纯音乐，请您欣赏",
    "[00:00.00]純音樂，請欣賞",
    "[00:00.00]No lyrics available",
    "[00:00.00]作曲：Example\n[00:01.00]混音：Example",
    "",
  ]) expect(sparse(parseLyrics(text))).toBe(true);
});

test("short real lyrics and late vocals stay available", () => {
  for (const text of [
    "[00:30.00]Hello world",
    "[00:00.00]Composer: Example\n[02:30.00]A voice returns",
    "[00:00.00]Instrumental\n[01:30.00]We sing again",
    "[00:00.00]An instrumental song in my head",
    "[00:20.00]我在这里\n[01:50.00]等着你",
  ]) expect(sparse(parseLyrics(text))).toBe(false);
});

test("interludes and punctuation do not count as sung lyrics", () => {
  expect(sparse([{ time: 0, text: "…", isInterlude: true }, { time: 5, text: "---" }])).toBe(true);
  expect(sparse([{ time: 0, text: "Ah", isBackground: true }])).toBe(false);
});
