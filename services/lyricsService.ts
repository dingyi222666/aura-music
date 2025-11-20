import { fetchViaProxy } from "./utils";

const LYRIC_API_BASE = "https://163api.qijieya.cn";
const METING_API = "https://api.qijieya.cn/meting/";
const NETEASE_SEARCH_API = "https://163api.qijieya.cn/cloudsearch";
const NETEASE_API_BASE = "http://music.163.com/api";
const NETEASECLOUD_API_BASE = "https://163api.qijieya.cn";

const METADATA_KEYWORDS = [
  "歌词贡献者",
  "翻译贡献者",
  "作词",
  "作曲",
  "编曲",
  "制作",
  "词曲",
  "词 / 曲",
  "lyricist",
  "composer",
  "arrange",
  "translation",
  "translator",
  "producer",
];

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const metadataKeywordRegex = new RegExp(
  `^(${METADATA_KEYWORDS.map(escapeRegex).join("|")})\\s*[:：]`,
  "iu",
);

const TIMESTAMP_REGEX = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/;

const isMetadataTimestampLine = (line: string): boolean => {
  const trimmed = line.trim();
  const match = trimmed.match(TIMESTAMP_REGEX);
  if (!match) return false;
  const content = match[4].trim();
  return metadataKeywordRegex.test(content);
};

const parseTimestampMetadata = (line: string) => {
  const match = line.trim().match(TIMESTAMP_REGEX);
  return match ? match[4].trim() : line.trim();
};

const isMetadataJsonLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    const json = JSON.parse(trimmed);
    if (json.c && Array.isArray(json.c)) {
      const content = json.c.map((item: any) => item.tx || "").join("");
      return metadataKeywordRegex.test(content);
    }
  } catch {
    // ignore invalid json
  }
  return false;
};

const parseJsonMetadata = (line: string) => {
  try {
    const json = JSON.parse(line.trim());
    if (json.c && Array.isArray(json.c)) {
      return json.c
        .map((item: any) => item.tx || "")
        .join("")
        .trim();
    }
  } catch {
    // ignore
  }
  return line.trim();
};

const extractMetadataLines = (content: string) => {
  const metadataSet = new Set<string>();
  const bodyLines: string[] = [];

  content.split("\n").forEach((line) => {
    if (!line.trim()) return;
    if (isMetadataTimestampLine(line)) {
      metadataSet.add(parseTimestampMetadata(line));
    } else if (isMetadataJsonLine(line)) {
      metadataSet.add(parseJsonMetadata(line));
    } else {
      bodyLines.push(line);
    }
  });

  return {
    clean: bodyLines.join("\n").trim(),
    metadata: Array.from(metadataSet),
  };
};

export const getNeteaseAudioUrl = (id: string) => {
  return `${METING_API}?type=url&id=${id}`;
};

// Implements the search logic from the user provided code snippet
export const searchNetEase = async (
  keyword: string,
  limit: number = 20,
): Promise<any[]> => {
  const searchApiUrl = `${NETEASE_SEARCH_API}?keywords=${encodeURIComponent(keyword)}&limit=${limit}`;

  try {
    // Use proxy since we are in browser
    const parsedSearchApiResponse = await fetchViaProxy(searchApiUrl);
    const searchData = parsedSearchApiResponse.result;

    if (!searchData || !searchData.songs || searchData.songs.length === 0) {
      return [];
    }

    return searchData.songs.map((song: any) => {
      return {
        id: song.id.toString(),
        title: song.name,
        artist: song.ar.map((artist: any) => artist.name).join("/"),
        album: song.al.name,
        coverUrl: song.al.picUrl, // Use if available, though standard search sometimes omits high res
        duration: song.dt,
        isNetease: true,
        neteaseId: song.id.toString(),
      };
    });
  } catch (error) {
    console.error("NetEase search error", error);
    return [];
  }
};

export const fetchNeteasePlaylist = async (playlistId: string) => {
  try {
    // 使用網易雲音樂 API 獲取歌單所有歌曲
    // 由於接口限制，需要分頁獲取，每次獲取 50 首
    const allTracks = [];
    const limit = 50;
    let offset = 0;
    let shouldContinue = true;

    while (shouldContinue) {
      const url = `${NETEASECLOUD_API_BASE}/playlist/track/all?id=${playlistId}&limit=${limit}&offset=${offset}`;
      const data = await fetchViaProxy(url);

      if (!data || !data.songs || data.songs.length === 0) {
        break;
      }

      const tracks = data.songs.map((track: any) => ({
        id: track.id.toString(),
        title: track.name,
        artist: track.ar?.map((a: any) => a.name).join("/") || "",
        album: track.al?.name || "",
        coverUrl: track.al?.picUrl || "",
        duration: track.dt,
        isNetease: true,
        neteaseId: track.id.toString(),
      }));

      allTracks.push(...tracks);

      // Continue fetching if we got 100 or more tracks
      if (data.songs.length < limit) {
        shouldContinue = false;
      } else {
        offset += limit;
      }
    }

    return allTracks;
  } catch (e) {
    console.error("Playlist fetch error", e);
    return [];
  }
};

export const fetchNeteaseSong = async (songId: string) => {
  try {
    const url = `${NETEASECLOUD_API_BASE}/song/detail?ids=${songId}`;
    const data = await fetchViaProxy(url);
    if (data.code === 200 && data.songs && data.songs.length > 0) {
      const track = data.songs[0];
      return {
        id: track.id.toString(),
        title: track.name,
        artist: track.ar.map((a: any) => a.name).join("/"),
        album: track.al.name,
        coverUrl: track.al.picUrl,
        isNetease: true,
        neteaseId: track.id.toString(),
      };
    }
    return null;
  } catch (e) {
    console.error("Song fetch error", e);
    return null;
  }
};

// Keeps the old search for lyric matching fallbacks
export const searchAndMatchLyrics = async (
  title: string,
  artist: string,
): Promise<{ lrc: string; tLrc?: string; metadata: string[] } | null> => {
  try {
    const songs = await searchNetEase(`${title} ${artist}`, 5);

    if (songs.length === 0) {
      console.warn("No songs found on Cloud");
      return null;
    }

    const songId = songs[0].id;
    console.log(`Found Song ID: ${songId}`);

    const lyricsResult = await fetchLyricsById(songId);
    return lyricsResult;
  } catch (error) {
    console.error("Cloud lyrics match failed:", error);
    return null;
  }
};

export const fetchLyricsById = async (
  songId: string,
): Promise<{ lrc: string; tLrc?: string; metadata: string[] } | null> => {
  try {
    // 使用網易雲音樂 API 獲取歌詞
    const lyricUrl = `${NETEASECLOUD_API_BASE}/lyric/new?id=${songId}`;
    const lyricData = await fetchViaProxy(lyricUrl);

    const yrc = lyricData.yrc?.lyric;
    const lrc = lyricData.lrc?.lyric;
    const tLrc = lyricData.tlyric?.lyric;

    let originalLrc = yrc || lrc;

    if (!originalLrc) return null;

    // Extract metadata from original lyrics
    const { clean: cleanOriginal, metadata: originalMetadata } =
      extractMetadataLines(originalLrc);

    // Extract metadata from translation if available
    let cleanTranslation: string | undefined;
    let translationMetadata: string[] = [];
    if (tLrc) {
      const result = extractMetadataLines(tLrc);
      cleanTranslation = result.clean;
      translationMetadata = result.metadata;
    }

    const metadataSet = new Set([...originalMetadata, ...translationMetadata]);
    if (lyricData.lyricUser?.nickname) {
      metadataSet.add(`歌词贡献者: ${lyricData.lyricUser.nickname}`);
    }
    if (lyricData.transUser?.nickname) {
      metadataSet.add(`翻译贡献者: ${lyricData.transUser.nickname}`);
    }

    return {
      lrc: cleanOriginal || originalLrc,
      tLrc: cleanTranslation,
      metadata: Array.from(metadataSet),
    };
  } catch (e) {
    console.error("Lyric fetch error", e);
    return null;
  }
};
