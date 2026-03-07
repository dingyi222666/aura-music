import { PlayMode, Song } from "../types";

const DB = "aura-music";
const VER = 1;
const FILES = "files";
const LIBRARY = "aura:library";
const PLAYBACK = "aura:playback";

const MODES = [PlayMode.LOOP_ALL, PlayMode.LOOP_ONE, PlayMode.SHUFFLE];

export interface StoredSong {
  id: string;
  title: string;
  artist: string;
  source: "local" | "remote";
  origin?: string;
  coverUrl?: string;
  lyrics?: Song["lyrics"];
  colors?: string[];
  needsLyricsMatch?: boolean;
  isNetease?: boolean;
  neteaseId?: string;
  album?: string;
}

export interface LibrarySnapshot {
  queue: StoredSong[];
  originalQueue: StoredSong[];
}

export interface RestoredSnapshot {
  queue: Song[];
  originalQueue: Song[];
}

export interface PlaybackSnapshot {
  songId: string | null;
  playMode: PlayMode;
}

const getDefaultPlayback = (): PlaybackSnapshot => {
  return {
    songId: null,
    playMode: PlayMode.LOOP_ALL,
  };
};

const hasWindow = () => {
  return typeof window !== "undefined";
};

const openDb = async (): Promise<IDBDatabase | null> => {
  if (!hasWindow() || !("indexedDB" in window)) {
    return null;
  }

  return await new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB, VER);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(FILES)) {
        db.createObjectStore(FILES);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open library database"));
  });
};

const waitReq = <T>(req: IDBRequest<T>): Promise<T> => {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
};

const waitTx = (tx: IDBTransaction): Promise<void> => {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
};

const runDb = async <T>(
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T>,
): Promise<T | null> => {
  const db = await openDb();
  if (!db) {
    return null;
  }

  const tx = db.transaction([FILES], mode);

  try {
    const value = await run(tx);
    await waitTx(tx);
    return value;
  } finally {
    db.close();
  }
};

export const toStoredSong = (song: Song): StoredSong => {
  const source = song.source ?? (song.fileUrl.startsWith("blob:") ? "local" : "remote");

  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    source,
    origin: source === "remote" ? song.origin ?? song.fileUrl : undefined,
    coverUrl: song.coverUrl,
    lyrics: song.lyrics,
    colors: song.colors,
    needsLyricsMatch: song.needsLyricsMatch,
    isNetease: song.isNetease,
    neteaseId: song.neteaseId,
    album: song.album,
  };
};

export const fromStoredSong = (song: StoredSong, fileUrl?: string): Song | null => {
  if (song.source === "local") {
    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      fileUrl: fileUrl ?? "",
      source: "local",
      coverUrl: song.coverUrl,
      lyrics: song.lyrics,
      colors: song.colors,
      needsLyricsMatch: song.needsLyricsMatch,
      isNetease: song.isNetease,
      neteaseId: song.neteaseId,
      album: song.album,
    };
  }

  const origin = song.origin ?? "";
  if (!origin) {
    return null;
  }

  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    fileUrl: origin,
    source: "remote",
    origin,
    coverUrl: song.coverUrl,
    lyrics: song.lyrics,
    colors: song.colors,
    needsLyricsMatch: song.needsLyricsMatch,
    isNetease: song.isNetease,
    neteaseId: song.neteaseId,
    album: song.album,
  };
};

const parseLibrarySnapshot = (raw: string | null): LibrarySnapshot => {
  if (!raw) {
    return {
      queue: [],
      originalQueue: [],
    };
  }

  try {
    const value = JSON.parse(raw) as Partial<LibrarySnapshot>;
    return {
      queue: Array.isArray(value.queue) ? value.queue : [],
      originalQueue: Array.isArray(value.originalQueue) ? value.originalQueue : [],
    };
  } catch {
    return {
      queue: [],
      originalQueue: [],
    };
  }
};

export const restoreLibrarySnapshot = (snap: LibrarySnapshot): RestoredSnapshot => {
  const restore = (list: StoredSong[]) => {
    return list
      .map((item) => fromStoredSong(item))
      .filter((item): item is Song => item !== null);
  };

  return {
    queue: restore(snap.queue),
    originalQueue: restore(snap.originalQueue),
  };
};

export const buildLibrarySnapshot = (
  queue: Song[],
  originalQueue: Song[],
): LibrarySnapshot => {
  return {
    queue: queue.map(toStoredSong),
    originalQueue: originalQueue.map(toStoredSong),
  };
};

export const loadLibrarySnapshot = (): LibrarySnapshot => {
  if (!hasWindow() || !("localStorage" in window)) {
    return {
      queue: [],
      originalQueue: [],
    };
  }

  return parseLibrarySnapshot(window.localStorage.getItem(LIBRARY));
};

export const saveLibrarySnapshot = (
  queue: Song[],
  originalQueue: Song[],
) => {
  if (!hasWindow() || !("localStorage" in window)) {
    return;
  }

  window.localStorage.setItem(
    LIBRARY,
    JSON.stringify(buildLibrarySnapshot(queue, originalQueue)),
  );
};

export const saveLocalFiles = async (list: Array<{ id: string; file: Blob }>) => {
  if (list.length === 0) {
    return;
  }

  await runDb("readwrite", async (tx) => {
    const store = tx.objectStore(FILES);
    await Promise.all(list.map((item) => waitReq(store.put(item.file, item.id))));
    return undefined;
  });
};

export const loadLocalFile = async (id: string): Promise<Blob | null> => {
  const value = await runDb("readonly", async (tx) => {
    const raw = await waitReq(tx.objectStore(FILES).get(id));
    return raw instanceof Blob ? raw : null;
  });

  return value ?? null;
};

export const deleteLocalFiles = async (ids: string[]) => {
  if (ids.length === 0) {
    return;
  }

  await runDb("readwrite", async (tx) => {
    const store = tx.objectStore(FILES);
    await Promise.all(ids.map((id) => waitReq(store.delete(id))));
    return undefined;
  });
};

export const hydrateLibrarySnapshot = async (snap: LibrarySnapshot) => {
  const urls = new Map<string, string>();

  const hydrate = async (list: StoredSong[]) => {
    const out: Song[] = [];

    for (const item of list) {
      if (item.source === "local") {
        let url = urls.get(item.id);

        if (!url) {
          const file = await loadLocalFile(item.id);
          if (!file) {
            continue;
          }

          url = URL.createObjectURL(file);
          urls.set(item.id, url);
        }

        out.push(fromStoredSong(item, url)!);
        continue;
      }

      const song = fromStoredSong(item);
      if (song) {
        out.push(song);
      }
    }

    return out;
  };

  return {
    queue: await hydrate(snap.queue),
    originalQueue: await hydrate(snap.originalQueue),
  };
};

export const parsePlaybackSnapshot = (raw: string | null): PlaybackSnapshot => {
  if (!raw) {
    return getDefaultPlayback();
  }

  try {
    const value = JSON.parse(raw) as Partial<PlaybackSnapshot>;
    const playMode = MODES.includes(value.playMode as PlayMode)
      ? (value.playMode as PlayMode)
      : PlayMode.LOOP_ALL;

    return {
      songId: typeof value.songId === "string" && value.songId.trim()
        ? value.songId
        : null,
      playMode,
    };
  } catch {
    return getDefaultPlayback();
  }
};

export const loadPlaybackSnapshot = (): PlaybackSnapshot => {
  if (!hasWindow() || !("localStorage" in window)) {
    return getDefaultPlayback();
  }

  return parsePlaybackSnapshot(window.localStorage.getItem(PLAYBACK));
};

export const savePlaybackSnapshot = (snap: PlaybackSnapshot) => {
  if (!hasWindow() || !("localStorage" in window)) {
    return;
  }

  window.localStorage.setItem(PLAYBACK, JSON.stringify(snap));
};
