import { getPalette } from "colorthief";
import jsmediatags from "jsmediatags/dist/jsmediatags.min.js";

import { LyricLine } from "@aura-music/core/types";
import { parseLyrics } from "@aura-music/lyrics/parser/index";
import { loadImageElementWithCache } from "@aura-music/core/cache";

export const formatTime = (seconds: number): string => {
  if (isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export const shuffleArray = <T>(array: T[]): T[] => {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
};

// Helper to request via CORS proxy (api.allorigins.win is reliable for GET requests)
// Try direct request first, fallback to proxy if CORS fails
export const fetchViaProxy = async (targetUrl: string): Promise<any> => {
  let text: string;

  // 1. Try direct request first
  try {
    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(
        `Direct fetch failed with status: ${response.status} ${targetUrl}`,
      );
    }
    text = await response.text();
    return JSON.parse(text);
  } catch (directError) {
    // 2. Direct request failed (likely CORS), try proxy
    console.warn(
      "Direct fetch failed (likely CORS), trying proxy:",
      directError,
    );

    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) {
        throw new Error(`Proxy fetch failed with status: ${response.status}`);
      }
      text = await response.text();
      return JSON.parse(text);
    } catch (proxyError) {
      console.error(
        "Both direct and proxy requests failed:",
        proxyError,
        targetUrl,
      );
      throw proxyError;
    }
  }
};

export const parseNeteaseLink = (
  input: string,
): { type: "song" | "playlist"; id: string } | null => {
  try {
    const url = new URL(input);
    const params = new URLSearchParams(url.search);
    // Handle music.163.com/#/song?id=... (Hash router)
    if (url.hash.includes("/song") || url.hash.includes("/playlist")) {
      const hashParts = url.hash.split("?");
      if (hashParts.length > 1) {
        const hashParams = new URLSearchParams(hashParts[1]);
        const id = hashParams.get("id");
        if (id) {
          if (url.hash.includes("/song")) return { type: "song", id };
          if (url.hash.includes("/playlist")) return { type: "playlist", id };
        }
      }
    }
    // Handle standard params
    const id = params.get("id");
    if (id) {
      if (url.pathname.includes("song")) return { type: "song", id };
      if (url.pathname.includes("playlist")) return { type: "playlist", id };
    }
    return null;
  } catch (e) {
    return null;
  }
};

/**
 * @deprecated Use parseLyrics from services/lyrics instead
 */
export const parseLrc = (
  lrcContent: string,
  translationContent?: string,
): LyricLine[] => {
  return parseLyrics(lrcContent, translationContent);
};

/**
 * @deprecated Use parseLyrics from services/lyrics instead
 */
export const mergeLyrics = (original: string, translation: string): string => {
  return original + "\n" + translation;
};

// Metadata Parser using jsmediatags
export const parseAudioMetadata = (
  file: File,
): Promise<{
  title?: string;
  artist?: string;
  picture?: string;
  lyrics?: string;
}> => {
  return new Promise((resolve) => {
    try {
      jsmediatags.read(file, {
        onSuccess: (tag) => {
          try {
            const tags = tag.tags;
            let pictureUrl = undefined;
            let lyricsText = undefined;

            if (tags.picture) {
              const { data, format } = tags.picture;
              let base64String = "";
              const len = data.length;
              for (let i = 0; i < len; i++) {
                base64String += String.fromCharCode(data[i]);
              }
              pictureUrl = `data:${format};base64,${window.btoa(base64String)}`;
            }

            // Extract embedded lyrics (USLT tag for unsynchronized lyrics)
            // Some formats also use "lyrics" or "LYRICS" tag
            if (tags.USLT) {
              // USLT can be an object with lyrics.text or just a string
              lyricsText =
                typeof tags.USLT === "object"
                  ? tags.USLT.lyrics || tags.USLT.text
                  : tags.USLT;
            } else if (tags.lyrics) {
              lyricsText = tags.lyrics;
            } else if (tags.LYRICS) {
              lyricsText = tags.LYRICS;
            }

            resolve({
              title: tags.title,
              artist: tags.artist,
              picture: pictureUrl,
              lyrics: lyricsText,
            });
          } catch (innerErr) {
            console.error("Error parsing tags structure:", innerErr);
            resolve({});
          }
        },
        onError: (error) => {
          console.warn("Error reading tags:", error);
          resolve({});
        },
      });
    } catch (err) {
      console.error("jsmediatags crashed:", err);
      resolve({});
    }
  });
};

export type ExtractedColors = string[] & {
  themeColor?: string;
};

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value));
};

const colorLum = (rgb: number[]) => {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
};

const colorSat = (rgb: number[]) => {
  return Math.max(...rgb) - Math.min(...rgb);
};

const colorDist = (a: number[], b: number[]) => {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
};

const toCssRgb = (rgb: number[]) => {
  return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(
    rgb[2],
  )})`;
};

const parseCssRgb = (color: string): number[] | null => {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return null;

  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const rgbToHsl = (rgb: number[]) => {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;

  if (max === min) {
    return { hue: 0, sat: 0, light };
  }

  const delta = max - min;
  const sat =
    light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue =
    max === r
      ? (g - b) / delta + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;

  return { hue: hue / 6, sat, light };
};

const hslToRgb = (hue: number, sat: number, light: number) => {
  if (sat === 0) {
    const value = Math.round(light * 255);
    return [value, value, value];
  }

  const toRgb = (p: number, q: number, t: number) => {
    let next = t;
    if (next < 0) next += 1;
    if (next > 1) next -= 1;
    if (next < 1 / 6) return p + (q - p) * 6 * next;
    if (next < 1 / 2) return q;
    if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
    return p;
  };

  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;

  return [
    Math.round(toRgb(p, q, hue + 1 / 3) * 255),
    Math.round(toRgb(p, q, hue) * 255),
    Math.round(toRgb(p, q, hue - 1 / 3) * 255),
  ];
};

const safeThemeRgb = (rgb: number[]) => {
  const hsl = rgbToHsl(rgb);
  return hslToRgb(
    hsl.hue,
    clamp(hsl.sat, 0.24, 0.58),
    clamp(hsl.light, 0.24, 0.42),
  );
};

const colorScore = (rgb: number[]) => {
  const lum = colorLum(rgb);
  const sat = colorSat(rgb);
  const balance = 1 - Math.min(1, Math.abs(lum - 140) / 140);
  return sat * 0.7 + balance * 90;
};

const themeScore = (rgb: number[], index: number) => {
  const lum = colorLum(rgb);
  const hsl = rgbToHsl(rgb);
  if (lum < 24 || lum > 238) return -Infinity;
  if (hsl.sat < 0.08 && (hsl.light < 0.18 || hsl.light > 0.82)) {
    return -Infinity;
  }

  const prevalence = Math.max(0, 20 - index) * 14;
  const usable = 1 - Math.min(1, Math.abs(hsl.light - 0.48) / 0.48);
  const colorfulness = Math.min(1, hsl.sat * 2.4);

  return prevalence + usable * 80 + colorfulness * 48;
};

const bucketRgb = (rgb: number[]) => {
  return rgb.map((value) => Math.round(value / 24) * 24);
};

const backgroundColorOf = (img: HTMLImageElement) => {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const buckets = new Map<
    string,
    { rgb: number[]; count: number; score: number }
  >();

  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      const edge = x < 12 || y < 12 || x >= size - 12 || y >= size - 12;
      const outer = x < 4 || y < 4 || x >= size - 4 || y >= size - 4;
      if (!edge && (x + y) % 8 !== 0) continue;

      const idx = (y * size + x) * 4;
      const rgb = [data[idx], data[idx + 1], data[idx + 2]];
      const lum = colorLum(rgb);
      if (lum < 18 || lum > 245) continue;

      const key = bucketRgb(rgb).join(",");
      const bucket = buckets.get(key) ?? { rgb: [0, 0, 0], count: 0, score: 0 };
      const weight = outer ? 4 : edge ? 2 : 1;
      bucket.rgb[0] += rgb[0] * weight;
      bucket.rgb[1] += rgb[1] * weight;
      bucket.rgb[2] += rgb[2] * weight;
      bucket.count += weight;
      bucket.score += weight;
      buckets.set(key, bucket);
    }
  }

  const picked = [...buckets.values()]
    .filter((bucket) => bucket.count >= 4)
    .map((bucket) => {
      const rgb = bucket.rgb.map((value) => value / bucket.count);
      const hsl = rgbToHsl(rgb);
      const usable = 1 - Math.min(1, Math.abs(hsl.light - 0.5) / 0.5);
      return {
        rgb,
        score: bucket.score + usable * 12 + Math.min(1, hsl.sat * 2) * 10,
      };
    })
    .sort((a, b) => b.score - a.score)[0];

  return picked?.rgb ?? null;
};

export const getThemeColor = (colors?: string[], fallback = "#16a34a") => {
  if (!colors || colors.length === 0) return fallback;

  const ranked = colors
    .map((color, index) => ({ color, index, rgb: parseCssRgb(color) }))
    .filter((item): item is { color: string; index: number; rgb: number[] } => {
      return item.rgb !== null;
    })
    .sort((a, b) => themeScore(b.rgb, b.index) - themeScore(a.rgb, a.index));

  if (ranked.length === 0) return fallback;

  return toCssRgb(safeThemeRgb(ranked[0].rgb));
};

export const extractColors = async (
  imageSrc: string,
): Promise<ExtractedColors> => {
  try {
    const img = await loadImageElementWithCache(imageSrc);
    const colors = await getPalette(img, { colorCount: 24 });
    const palette = colors?.map((item) => item.array()) ?? [];

    if (!palette || palette.length === 0) {
      return [];
    }

    const filtered = palette.filter((rgb) => {
      const lum = colorLum(rgb);
      const sat = colorSat(rgb);
      if (lum < 20) return false;
      if (lum > 240 && sat < 30) return false;
      if (sat < 15 && lum > 200) return false;
      return true;
    });

    const candidates = filtered.length >= 6 ? filtered : palette;

    // Sort by vibrance and contrast score for UI accent/background effects.
    const ranked = candidates
      .slice()
      .sort((a: number[], b: number[]) => colorScore(b) - colorScore(a));

    const picked: number[][] = [];
    // Pass 1: Strict distance for max diversity
    for (const rgb of ranked) {
      if (picked.some((item) => colorDist(item, rgb) < 1400)) continue;
      picked.push(rgb);
    }

    // Pass 2: Lower distance threshold if we don't have enough colors
    if (picked.length < 8) {
      for (const rgb of ranked) {
        if (picked.includes(rgb)) continue;
        if (picked.some((item) => colorDist(item, rgb) < 400)) continue;
        picked.push(rgb);
        if (picked.length >= 8) break;
      }
    }

    // Pass 3: Just add remaining colors if we are still desperate
    if (picked.length < 6) {
      for (const rgb of palette) {
        if (picked.includes(rgb)) continue;
        picked.push(rgb);
        if (picked.length >= 6) break;
      }
    }

    const result = picked.slice(0, 10).map(toCssRgb) as ExtractedColors;
    const theme =
      backgroundColorOf(img) ??
      palette
        .map((rgb, index) => ({ rgb, index, score: themeScore(rgb, index) }))
        .sort((a, b) => b.score - a.score)[0]?.rgb;

    if (theme) {
      result.themeColor = toCssRgb(safeThemeRgb(theme));
    }

    return result;
  } catch (err) {
    console.warn("Color extraction failed", err);
    return [];
  }
};
