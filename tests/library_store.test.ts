import { expect, test } from "bun:test";
import {
  fromStoredSong,
  parsePlaybackSnapshot,
  toStoredSong,
} from "../services/libraryStore";
import { PlayMode, Song } from "../types";

test("remote songs keep their original source url", () => {
  const song: Song = {
    id: "42",
    title: "Aura",
    artist: "Test",
    fileUrl: "https://redirected.example/file.mp3",
    source: "remote",
    origin: "https://api.example/audio?id=42",
  };

  expect(toStoredSong(song)).toEqual({
    id: "42",
    title: "Aura",
    artist: "Test",
    source: "remote",
    origin: "https://api.example/audio?id=42",
    coverUrl: undefined,
    lyrics: undefined,
    colors: undefined,
    needsLyricsMatch: undefined,
    isNetease: undefined,
    neteaseId: undefined,
    album: undefined,
  });
});

test("remote songs fall back to fileUrl when origin is missing", () => {
  const song: Song = {
    id: "43",
    title: "Glow",
    artist: "Test",
    fileUrl: "https://api.example/audio?id=43",
  };

  expect(toStoredSong(song).origin).toBe("https://api.example/audio?id=43");
});

test("local songs are restored from stored metadata and blob url", () => {
  const song = fromStoredSong(
    {
      id: "local-1",
      title: "Local",
      artist: "Singer",
      source: "local",
      colors: ["rgb(1, 2, 3)"],
    },
    "blob:test",
  );

  expect(song).toEqual({
    id: "local-1",
    title: "Local",
    artist: "Singer",
    fileUrl: "blob:test",
    source: "local",
    coverUrl: undefined,
    lyrics: undefined,
    colors: ["rgb(1, 2, 3)"],
    needsLyricsMatch: undefined,
    isNetease: undefined,
    neteaseId: undefined,
    album: undefined,
  });
});

test("playback snapshot parser keeps valid data and rejects bad modes", () => {
  expect(
    parsePlaybackSnapshot(JSON.stringify({
      songId: "abc",
      playMode: PlayMode.SHUFFLE,
    })),
  ).toEqual({
    songId: "abc",
    playMode: PlayMode.SHUFFLE,
  });

  expect(
    parsePlaybackSnapshot(JSON.stringify({
      songId: "abc",
      playMode: 99,
    })),
  ).toEqual({
    songId: "abc",
    playMode: PlayMode.LOOP_ALL,
  });

  expect(parsePlaybackSnapshot("not-json")).toEqual({
    songId: null,
    playMode: PlayMode.LOOP_ALL,
  });
});
