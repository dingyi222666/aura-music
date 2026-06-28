/**
 * Lyric Overlay Sync — 把当前歌曲的歌词+播放进度推送到桌面歌词窗口。
 *
 * 协议（与 lyric-overlay-server/server.js 对齐）：
 *   推送：{ type: "state", songId, title, artist, lines, currentTime, duration, isPlaying }
 *   反向控制（桌面歌词 → aura-music）：{ type: "control", action: "play"|"pause"|"prev"|"next"|"quit" }
 *   心跳：{ type: "ping" }
 *
 * 推送节流：
 *   - 切歌、lyrics 变化：立即推送
 *   - currentTime 变化：节流 120ms（约 8 fps，桌面歌词不需要更高）
 *   - isPlaying 变化：立即推送
 */

import { useEffect, useRef, useCallback } from "react";
import { PlayState } from "../types";
import type { Song } from "../types";

const WS_URL = "ws://127.0.0.1:8787";
const HTTP_BASE = "http://127.0.0.1:8787";
const RECONNECT_INTERVAL_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 25000;
const POSITION_THROTTLE_MS = 120;

export type ControlAction = "play" | "pause" | "prev" | "next" | "quit";

interface OverlayState {
  type: "state";
  songId: string | null;
  title: string;
  artist: string;
  lines: { time: number; text: string; translation?: string }[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
}

interface UseLyricOverlayParams {
  currentSong: Song | null;
  playState: PlayState;
  currentTime: number;
  duration: number;
  /** 桌面歌词开关：true=推送歌词，false=停止推送 */
  enabled: boolean;
  /** 接收桌面歌词窗口发来的控制指令 */
  onControl?: (action: ControlAction) => void;
}

/**
 * 通过 HTTP 接口启动桌面歌词 exe
 * （需要 lyric-overlay-server 提供 POST /launch 接口）
 */
export const launchDesktopLyrics = async (): Promise<{ ok: boolean; message: string }> => {
  try {
    const res = await fetch(`${HTTP_BASE}/launch`, { method: "POST" });
    const data = await res.json();
    return { ok: !!data.ok, message: data.message ?? "" };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
};

/**
 * 通过 HTTP 接口关闭桌面歌词 exe
 */
export const quitDesktopLyrics = async (): Promise<{ ok: boolean; message: string }> => {
  try {
    const res = await fetch(`${HTTP_BASE}/quit`, { method: "POST" });
    const data = await res.json();
    return { ok: !!data.ok, message: data.message ?? "" };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
};

/**
 * 查询桌面歌词运行状态
 */
export const queryDesktopLyricsStatus = async (): Promise<{
  ok: boolean;
  running: boolean;
  exeExists: boolean;
} | null> => {
  try {
    const res = await fetch(`${HTTP_BASE}/status`);
    const data = await res.json();
    return {
      ok: !!data.ok,
      running: !!data.desktopLyricsRunning,
      exeExists: !!data.exeExists,
    };
  } catch {
    return null;
  }
};

export const useLyricOverlay = ({
  currentSong,
  playState,
  currentTime,
  duration,
  enabled,
  onControl,
}: UseLyricOverlayParams) => {
  const wsRef = useRef<WebSocket | null>(null);
  const lastStatePushRef = useRef<number>(0);
  const lastSongIdRef = useRef<string | null>(null);
  const lastLyricsLenRef = useRef<number>(0);
  const lastPlayingRef = useRef<boolean>(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const enabledRef = useRef<boolean>(enabled);
  const onControlRef = useRef<typeof onControl>(onControl);

  // 同步 ref，避免 useEffect 依赖变化导致重连
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    onControlRef.current = onControl;
  }, [onControl]);

  // 构造状态对象
  const buildState = useCallback((): OverlayState => {
    const lyrics = currentSong?.lyrics ?? [];
    return {
      type: "state",
      songId: currentSong?.id ?? null,
      title: currentSong?.title ?? "",
      artist: currentSong?.artist ?? "",
      lines: lyrics
        .filter((l) => !l.isMetadata)
        .map((l) => ({
          time: l.time,
          text: l.text,
          translation: l.translation,
        })),
      currentTime,
      duration,
      isPlaying: playState === PlayState.PLAYING,
    };
  }, [currentSong, currentTime, duration, playState]);

  // 实际推送
  const flushState = useCallback((force = false) => {
    // enabled=false 时不推送
    if (!enabledRef.current) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    if (!force && now - lastStatePushRef.current < POSITION_THROTTLE_MS) {
      return;
    }
    lastStatePushRef.current = now;

    try {
      ws.send(JSON.stringify(buildState()));
    } catch {
      // ignore
    }
  }, [buildState]);

  // 建立连接（自动重连）。enabled 变化时不重连，只控制是否推送。
  useEffect(() => {
    let closed = false;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.info("[lyric-overlay] connected to", WS_URL);
        if (enabledRef.current) flushState(true);
        if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: "ping" }));
            } catch {
              // ignore
            }
          }
        }, HEARTBEAT_INTERVAL_MS);
      };

      ws.onclose = () => {
        if (closed) return;
        console.info("[lyric-overlay] disconnected, will retry in", RECONNECT_INTERVAL_MS, "ms");
        wsRef.current = null;
        if (heartbeatTimerRef.current) {
          clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_INTERVAL_MS);
      };

      ws.onerror = () => {
        try { ws.close(); } catch { /* ignore */ }
      };

      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === "control") {
          // 桌面歌词窗口发来的控制指令
          console.info("[lyric-overlay] control:", msg.action);
          onControlRef.current?.(msg.action as ControlAction);
        }
        // state 消息是 aura-music 自己发的，忽略
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
    };
  }, []);

  // 切歌 / 歌词变化 / 播放状态变化 → 立即推送（enabled 时）
  useEffect(() => {
    const songId = currentSong?.id ?? null;
    const lyricsLen = currentSong?.lyrics?.length ?? 0;
    const isPlaying = playState === PlayState.PLAYING;

    if (
      songId !== lastSongIdRef.current ||
      lyricsLen !== lastLyricsLenRef.current ||
      isPlaying !== lastPlayingRef.current
    ) {
      lastSongIdRef.current = songId;
      lastLyricsLenRef.current = lyricsLen;
      lastPlayingRef.current = isPlaying;
      flushState(true);
    }
  }, [currentSong?.id, currentSong?.lyrics, playState, flushState]);

  // 播放进度变化 → 节流推送
  useEffect(() => {
    flushState(false);
  }, [currentTime, duration, flushState]);

  // enabled 从 false→true 时立即推一次状态（让桌面歌词快速恢复显示）
  useEffect(() => {
    if (enabled) {
      flushState(true);
    }
  }, [enabled, flushState]);
};
