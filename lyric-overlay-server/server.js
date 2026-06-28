// Aura Music Lyric Overlay Server
// WebSocket 中继 + HTTP 控制接口
//
// 协议（JSON）：
//   推送方（aura-music）→ server → 所有订阅方（桌面歌词）
//   { type: "state", songId, title, artist, lines, currentTime, duration, isPlaying }
//   { type: "ping" }
//
//   控制消息（双向，谁发都广播给其他人）：
//   { type: "control", action: "play"|"pause"|"prev"|"next"|"quit"|"show"|"hide" }
//
// HTTP 接口：
//   POST /launch   启动桌面歌词 exe
//   POST /quit     关闭桌面歌词 exe
//   GET  /status   查询状态

import { WebSocketServer } from "ws";
import { createServer } from "http";
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.LYRIC_WS_PORT ?? 8787);

// 桌面歌词 exe 路径：项目根目录 ../desktop-lyrics/src-tauri/target/release/aura-desktop-lyrics.exe
const DESKTOP_LYRICS_EXE = path.resolve(
  __dirname,
  "..",
  "desktop-lyrics",
  "src-tauri",
  "target",
  "release",
  "aura-desktop-lyrics.exe",
);

// 状态缓存：晚加入的客户端立即拿到当前曲目
let lastState = null;

// 桌面歌词子进程引用
let desktopLyricsProc = null;

// ============== HTTP 控制接口 ==============

const launchDesktopLyrics = () => {
  if (desktopLyricsProc && !desktopLyricsProc.killed) {
    return { ok: true, message: "already running", pid: desktopLyricsProc.pid };
  }
  if (!existsSync(DESKTOP_LYRICS_EXE)) {
    return { ok: false, message: `exe not found: ${DESKTOP_LYRICS_EXE}` };
  }
  try {
    desktopLyricsProc = spawn(DESKTOP_LYRICS_EXE, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    desktopLyricsProc.unref();
    desktopLyricsProc.on("exit", (code) => {
      console.log(`[lyric-overlay] desktop lyrics exited (code=${code})`);
      desktopLyricsProc = null;
    });
    console.log(`[lyric-overlay] launched desktop lyrics (pid=${desktopLyricsProc.pid})`);
    return { ok: true, message: "launched", pid: desktopLyricsProc.pid };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
};

const quitDesktopLyrics = () => {
  if (!desktopLyricsProc || desktopLyricsProc.killed) {
    return { ok: true, message: "not running" };
  }
  try {
    spawn("taskkill", ["/F", "/T", "/PID", String(desktopLyricsProc.pid)], {
      stdio: "ignore",
      windowsHide: true,
    });
    desktopLyricsProc = null;
    console.log(`[lyric-overlay] killed desktop lyrics`);
    return { ok: true, message: "killed" };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
};

const httpServer = createServer((req, res) => {
  // CORS: aura-music 跑在 :3000，server 在 :8787
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === "POST" && url.pathname === "/launch") {
    const result = launchDesktopLyrics();
    res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === "POST" && url.pathname === "/quit") {
    const result = quitDesktopLyrics();
    res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === "GET" && url.pathname === "/status") {
    const running = !!(desktopLyricsProc && !desktopLyricsProc.killed);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      desktopLyricsRunning: running,
      exeExists: existsSync(DESKTOP_LYRICS_EXE),
      exePath: DESKTOP_LYRICS_EXE,
      wsClients: wss.clients.size,
    }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, message: "not found" }));
});

// HTTP server 先监听端口，WS server 挂在同一个 HTTP server 上
httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`[lyric-overlay] HTTP server listening on http://127.0.0.1:${PORT}`);
  console.log(`[lyric-overlay] WebSocket server attached to same port`);
  console.log(`[lyric-overlay] HTTP control: POST /launch | POST /quit | GET /status`);
  console.log(`[lyric-overlay] Desktop lyrics exe: ${DESKTOP_LYRICS_EXE}`);
  console.log(`[lyric-overlay] Waiting for aura-music to connect...`);
});

httpServer.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[lyric-overlay] Port ${PORT} already in use. Is another instance running?`);
  } else {
    console.error(`[lyric-overlay] HTTP server error:`, err);
  }
  process.exit(1);
});

// WebSocket server 挂在同一个 HTTP server 上
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[ws] client connected from ${ip} (total ${wss.clients.size})`);

  if (lastState) {
    try { ws.send(lastState); } catch (e) { /* ignore */ }
  }

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }

    if (msg.type === "state") {
      lastState = raw.toString();
      for (const client of wss.clients) {
        if (client !== ws && client.readyState === ws.OPEN) {
          try { client.send(raw.toString()); } catch (e) { /* ignore */ }
        }
      }
    } else if (msg.type === "control") {
      console.log(`[ws] control: ${msg.action} (from ${ip})`);
      for (const client of wss.clients) {
        if (client !== ws && client.readyState === ws.OPEN) {
          try { client.send(raw.toString()); } catch (e) { /* ignore */ }
        }
      }
    } else if (msg.type === "ping") {
      try { ws.send(JSON.stringify({ type: "pong", t: Date.now() })); } catch (e) { /* ignore */ }
    }
  });

  ws.on("close", () => {
    console.log(`[ws] client disconnected (total ${wss.clients.size})`);
  });

  ws.on("error", (err) => {
    console.warn(`[ws] client error:`, err.message);
  });
});

const shutdown = (sig) => {
  console.log(`\n[lyric-overlay] ${sig} received, shutting down...`);
  if (desktopLyricsProc && !desktopLyricsProc.killed) {
    quitDesktopLyrics();
  }
  wss.clients.forEach((c) => c.terminate());
  httpServer.close(() => process.exit(0));
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
