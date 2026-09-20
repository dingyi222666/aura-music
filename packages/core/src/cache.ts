const MOBILE_BREAKPOINT = 1024;

const isMobileViewport = () => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
};

const createSizeLimitedLRU = (limitBytes: number) => {
  const map = new Map<string, { blob: Blob; size: number }>();
  let totalSize = 0;

  const evictIfNeeded = () => {
    while (totalSize > limitBytes && map.size > 0) {
      const oldestKey = map.keys().next().value;
      if (!oldestKey) break;
      const entry = map.get(oldestKey);
      map.delete(oldestKey);
      if (entry) {
        totalSize -= entry.size;
      }
    }
  };

  return {
    get(key: string): Blob | null {
      const entry = map.get(key);
      if (!entry) return null;
      map.delete(key);
      map.set(key, entry);
      return entry.blob;
    },
    set(key: string, blob: Blob) {
      const size = blob.size || 0;
      if (size <= 0 || size > limitBytes) {
        return;
      }
      if (map.has(key)) {
        const existing = map.get(key);
        if (existing) {
          totalSize -= existing.size;
        }
        map.delete(key);
      }
      map.set(key, { blob, size });
      totalSize += size;
      evictIfNeeded();
    },
    delete(key: string) {
      const entry = map.get(key);
      if (!entry) return;
      totalSize -= entry.size;
      map.delete(key);
    },
    clear() {
      map.clear();
      totalSize = 0;
    },
    getLimit() {
      return limitBytes;
    },
  };
};

const IMAGE_CACHE_LIMIT = isMobileViewport() ? 50 * 1024 * 1024 : 100 * 1024 * 1024;
const AUDIO_CACHE_LIMIT = isMobileViewport() ? 100 * 1024 * 1024 : 200 * 1024 * 1024;
const RAW_IMAGE_CACHE_LIMIT = 50 * 1024 * 1024;

const rawImageCache = createSizeLimitedLRU(RAW_IMAGE_CACHE_LIMIT);

export const imageResourceCache = createSizeLimitedLRU(IMAGE_CACHE_LIMIT);
export const audioResourceCache = createSizeLimitedLRU(AUDIO_CACHE_LIMIT);

export const fetchImageBlobWithCache = async (url: string): Promise<Blob> => {
  const cached = rawImageCache.get(url);
  if (cached) {
    return cached;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  const blob = await response.blob();
  rawImageCache.set(url, blob);
  return blob;
};

export const loadImageElementWithCache = async (
  url: string,
): Promise<HTMLImageElement> => {
  const blob = await fetchImageBlobWithCache(url);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const objectUrl = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = (error) => {
      URL.revokeObjectURL(objectUrl);
      reject(error);
    };
    img.src = objectUrl;
  });
};
