import { fetchViaProxy } from "./utils";
import { isMetadataLine } from "./lyrics/types";

const LYRIC_API_BASE = "https://163api.qijieya.cn";
const METING_API = "https://api.qijieya.cn/meting/";
const NETEASE_SEARCH_API = "https://163api.qijieya.cn/cloudsearch";
const NETEASE_API_BASE = "http://music.163.com/api";
const NETEASECLOUD_API_BASE = "https://163api.qijieya.cn";
const TTML_DB_BASE = "https://amll-ttml-db.stevexmh.net";

const TIMESTAMP_REGEX = /^\[(\d{2}):(\d{2})[\.:](\d{2,3})\](.*)$/;

interface NeteaseApiArtist {
  name?: string;
}

interface NeteaseApiAlbum {
  name?: string;
  picUrl?: string;
}

interface NeteaseApiSong {
  id: number;
  name?: string;
  ar?: NeteaseApiArtist[];
  al?: NeteaseApiAlbum;
  dt?: number;
}

interface NeteaseSearchResponse {
  result?: {
    songs?: NeteaseApiSong[];
  };
}

interface NeteasePlaylistResponse {
  songs?: NeteaseApiSong[];
}

interface NeteaseSongDetailResponse {
  code?: number;
  songs?: NeteaseApiSong[];
}

export interface MatchedLyricsResult {
  lrc?: string;
  yrc?: string;
  tLrc?: string;
  ttml?: string;
  metadata: string[];
}

export interface NeteaseTrackInfo {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl?: string;
  duration?: number;
  isNetease: true;
  neteaseId: string;
}

type SearchOptions = {
  limit?: number;
  offset?: number;
};

const formatArtists = (artists?: NeteaseApiArtist[]) =>
  (artists ?? [])
    .map((artist) => artist.name?.trim())
    .filter(Boolean)
    .join("/") || "";

const mapNeteaseSongToTrack = (song: NeteaseApiSong): NeteaseTrackInfo => ({
  id: song.id.toString(),
  title: song.name?.trim() ?? "",
  artist: formatArtists(song.ar),
  album: song.al?.name?.trim() ?? "",
  coverUrl: song.al?.picUrl?.replaceAll("http:", "https:"),
  duration: song.dt,
  isNetease: true,
  neteaseId: song.id.toString(),
});

const isMetadataTimestampLine = (line: string): boolean => {
  const trimmed = line.trim();
  const match = trimmed.match(TIMESTAMP_REGEX);
  if (!match) return false;
  const content = match[4].trim();
  return isMetadataLine(content);
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
    // In NetEase lyric payloads, JSON lines are credit metadata entries.
    return Boolean(json.c && Array.isArray(json.c));
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

const TTML_META_LABELS: Record<string, string> = {
  musicName: "歌曲名",
  artists: "艺术家",
  album: "专辑",
  ncmMusicId: "网易云 ID",
  qqMusicId: "QQ 音乐 ID",
  spotifyId: "Spotify ID",
  appleMusicId: "Apple Music ID",
  ttmlAuthorGithub: "TTML 作者 ID",
  ttmlAuthorGithubLogin: "TTML 作者",
};

const extractTtmlMetadata = (content?: string): string[] => {
  if (!content) return [];

  const meta: string[] = [];
  const regex = /<amll:meta[^>]*\bkey="([^"]+)"[^>]*\bvalue="([^"]*)"[^>]*\/>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const key = match[1];
    const value = match[2]?.trim();
    if (!value) continue;
    const label = TTML_META_LABELS[key] || key;
    meta.push(`${label}: ${value}`);
  }

  if (meta.length > 0) {
    meta.unshift("TTML 歌词来源: AMLL TTML Database");
  }

  return meta;
};

export const getNeteaseAudioUrl = (id: string) => {
  return `${METING_API}?type=url&id=${id}`;
};

const fetchTtmlByNeteaseId = async (id: string): Promise<string | null> => {
  const url = `${TTML_DB_BASE}/ncm/${encodeURIComponent(id)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status !== 404) {
        console.warn("TTML lyrics fetch failed", res.status, id);
      }
      return null;
    }

    const text = await res.text();
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (err) {
    console.error("TTML lyrics request error", err);
    return null;
  }
};

// Implements the search logic from the user provided code snippet
export const searchNetEase = async (
  keyword: string,
  options: SearchOptions = {},
): Promise<NeteaseTrackInfo[]> => {
  const { limit = 20, offset = 0 } = options;
  const searchApiUrl = `${NETEASE_SEARCH_API}?keywords=${encodeURIComponent(
    keyword,
  )}&limit=${limit}&offset=${offset}`;

  try {
    const parsedSearchApiResponse = (await fetchViaProxy(
      searchApiUrl,
    )) as NeteaseSearchResponse;
    const songs = parsedSearchApiResponse.result?.songs ?? [];

    if (songs.length === 0) {
      return [];
    }

    return songs.map(mapNeteaseSongToTrack);
  } catch (error) {
    console.error("NetEase search error", error);
    return [];
  }
};

export const fetchNeteasePlaylist = async (
  playlistId: string,
): Promise<NeteaseTrackInfo[]> => {
  try {
    // 使用網易雲音樂 API 獲取歌單所有歌曲
    // 由於接口限制，需要分頁獲取，每次獲取 50 首
    const allTracks: NeteaseTrackInfo[] = [];
    const limit = 50;
    let offset = 0;
    let shouldContinue = true;

    while (shouldContinue) {
      const url = `${NETEASECLOUD_API_BASE}/playlist/track/all?id=${playlistId}&limit=${limit}&offset=${offset}`;
      const data = (await fetchViaProxy(url)) as NeteasePlaylistResponse;
      const songs = data.songs ?? [];
      if (songs.length === 0) {
        break;
      }

      const tracks = songs.map(mapNeteaseSongToTrack);

      allTracks.push(...tracks);

      // Continue fetching if the current page was full
      if (songs.length < limit) {
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

export const fetchNeteaseSong = async (
  songId: string,
): Promise<NeteaseTrackInfo | null> => {
  try {
    const url = `${NETEASECLOUD_API_BASE}/song/detail?ids=${songId}`;
    const data = (await fetchViaProxy(
      url,
    )) as NeteaseSongDetailResponse;
    const track = data.songs?.[0];
    if (data.code === 200 && track) {
      return mapNeteaseSongToTrack(track);
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
): Promise<MatchedLyricsResult | null> => {
  try {
    const songs = await searchNetEase(`${title} ${artist}`, { limit: 5 });

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
): Promise<MatchedLyricsResult | null> => {
  try {
    // Fetch TTML and NetEase lyrics in parallel
    const [ttmlContent, lyricDataResult] = await Promise.all([
      fetchTtmlByNeteaseId(songId),
      (async () => {
        const lyricUrl = `${NETEASECLOUD_API_BASE}/lyric/new?id=${songId}`;
        try {
          return await fetchViaProxy(lyricUrl);
        } catch (err) {
          console.error("Lyric fetch error", err);
          return null;
        }
      })(),
    ]);

    const lyricData = lyricDataResult as any;

    const rawYrc: string | undefined = lyricData?.yrc?.lyric;
    const rawLrc: string | undefined = lyricData?.lrc?.lyric;
    const tLrcRaw: string | undefined = lyricData?.tlyric?.lyric;

    const lrcMeta = rawLrc ? extractMetadataLines(rawLrc) : { clean: undefined, metadata: [] };
    const yrcMeta = rawYrc ? extractMetadataLines(rawYrc) : { clean: undefined, metadata: [] };

    let cleanTranslation: string | undefined;
    let translationMetadata: string[] = [];
    if (tLrcRaw) {
      const result = extractMetadataLines(tLrcRaw);
      cleanTranslation = result.clean;
      translationMetadata = result.metadata;
    }

    const ttmlMetadata = extractTtmlMetadata(ttmlContent ?? undefined);

    const metadataSet = new Set<string>([...lrcMeta.metadata, ...yrcMeta.metadata, ...translationMetadata, ...ttmlMetadata]);

    if (lyricData?.transUser?.nickname) {
      metadataSet.add(`翻译贡献者: ${lyricData.transUser.nickname}`);
    }

    if (lyricData?.lyricUser?.nickname) {
      metadataSet.add(`歌词贡献者: ${lyricData.lyricUser.nickname}`);
    }

    const baseLyrics = lrcMeta.clean || yrcMeta.clean || rawLrc || rawYrc;

    if (!ttmlContent && !baseLyrics) {
      return null;
    }

    const yrcForEnrichment = yrcMeta.clean && lrcMeta.clean ? yrcMeta.clean : undefined;

    return {
      lrc: baseLyrics,
      yrc: yrcForEnrichment,
      tLrc: cleanTranslation,
      ttml: ttmlContent ?? undefined,
      metadata: Array.from(metadataSet),
    };
  } catch (e) {
    console.error("Lyric fetch pipeline error", e);
    return null;
  }
};
