import { LyricLine } from "../types";
import { parseLyrics } from "./lyrics";

// Declare global for the script loaded in index.html
declare const jsmediatags: any;
declare const ColorThief: any;

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
    if (typeof jsmediatags === "undefined") {
      console.warn("jsmediatags not loaded");
      resolve({});
      return;
    }

    try {
      jsmediatags.read(file, {
        onSuccess: (tag: any) => {
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
        onError: (error: any) => {
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

export const extractColors = async (imageSrc: string): Promise<string[]> => {
  return new Promise((resolve) => {
    if (typeof ColorThief === "undefined") {
      console.warn("ColorThief not loaded");
      resolve(["#4f46e5", "#db2777", "#1f2937"]);
      return;
    }

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = imageSrc;

    img.onload = () => {
      try {
        const colorThief = new ColorThief();
        // 1. Get a palette of 5 colors
        const palette = colorThief.getPalette(img, 5);

        if (!palette || palette.length === 0) {
          resolve([]);
          return;
        }

        // 2. Filter out near-black/dark colors
        // Luminance: 0.2126 R + 0.7152 G + 0.0722 B
        const vibrantCandidates = palette.filter((rgb: number[]) => {
          const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
          // Threshold: remove colors darker than ~30/255 luminance
          return lum > 30;
        });

        // If we filtered everything out (very dark album), fall back to original palette
        const candidates =
          vibrantCandidates.length > 0 ? vibrantCandidates : palette;

        // 3. Sort by "Vibrancy" (approx Saturation: Max - Min channel value)
        candidates.sort((a: number[], b: number[]) => {
          const satA = Math.max(...a) - Math.min(...a);
          const satB = Math.max(...b) - Math.min(...b);
          return satB - satA; // Descending saturation
        });

        // 4. Take Top 4
        const topColors = candidates.slice(0, 4);

        const colorStrings = topColors.map((c: number[]) => {
          return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
        });
        resolve(colorStrings);
      } catch (e) {
        console.warn("Color extraction failed", e);
        resolve([]);
      }
    };

    img.onerror = () => {
      resolve([]);
    };
  });
};
