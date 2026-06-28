// Aura Desktop Lyrics — 前端逻辑
// 连接 ws://127.0.0.1:8787，接收 aura-music 推送的歌词+进度，渲染当前行+翻译。
// 反向控制：按钮 → WS control 消息 → server 广播 → aura-music 执行

const WS_URL = "ws://127.0.0.1:8787";
const RECONNECT_MS = 2500;

const state = {
  /** @type {{time:number,text:string,translation?:string}[]} */
  lines: [],
  currentTime: 0,
  isPlaying: false,
  title: "",
  artist: "",
  /** 当前显示的行索引（-1=未匹配） */
  currentIdx: -1,
  passthrough: false,
  fontSize: 26,
};

const elApp = document.getElementById("app");
const elOriginal = document.getElementById("line-original");
const elTranslation = document.getElementById("line-translation");
const elBlock = document.getElementById("lyric-block");
const elToolbar = document.getElementById("toolbar");
const elBtnPlayPause = document.getElementById("btn-play-pause");
const elPassthroughToast = document.getElementById("passthrough-toast");
let passthroughToastTimer = null;

// ============== 渲染 ==============

function findCurrentLineIndex(time) {
  if (state.lines.length === 0) return -1;
  let lo = 0;
  let hi = state.lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (state.lines[mid].time <= time) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function render(force = false) {
  const idx = findCurrentLineIndex(state.currentTime);
  if (idx === state.currentIdx && !force) return;
  state.currentIdx = idx;

  if (idx < 0 || !state.lines[idx]) {
    elOriginal.textContent = state.title ? `${state.title} — ${state.artist}` : "等待 aura-music 开始播放…";
    elOriginal.classList.add("empty");
    elTranslation.textContent = "";
    elTranslation.style.display = "none";
    return;
  }

  const line = state.lines[idx];
  elOriginal.classList.toggle("empty", !line.text);
  elOriginal.textContent = line.text || "♪";
  elTranslation.textContent = line.translation || "";
  elTranslation.style.display = line.translation ? "block" : "none";

  elBlock.classList.remove("fade-enter");
  void elBlock.offsetWidth;
  elBlock.classList.add("fade-enter");
}

// 更新播放/暂停按钮图标
function updatePlayPauseIcon() {
  if (elBtnPlayPause) {
    elBtnPlayPause.textContent = state.isPlaying ? "⏸" : "▶";
    elBtnPlayPause.title = state.isPlaying ? "暂停" : "播放";
  }
}

// ============== WebSocket ==============

let ws = null;
let reconnectTimer = null;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("[desktop-lyrics] connected");
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }

    if (msg.type === "state") {
      const linesChanged =
        msg.lines?.length !== state.lines.length ||
        msg.songId !== state.songId;
      const playingChanged = msg.isPlaying !== state.isPlaying;

      state.songId = msg.songId;
      state.lines = msg.lines || [];
      state.title = msg.title || "";
      state.artist = msg.artist || "";
      state.isPlaying = !!msg.isPlaying;
      state.currentTime = msg.currentTime || 0;

      render(linesChanged);
      if (playingChanged) updatePlayPauseIcon();
    }
    // control 消息：aura-music 也可以向桌面歌词发命令（show/hide），暂时忽略
  };

  ws.onclose = () => {
    console.log("[desktop-lyrics] disconnected, retry in", RECONNECT_MS, "ms");
    ws = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
  };

  ws.onerror = () => {
    try { ws.close(); } catch {}
  };
}

/** 向 WS 发送 control 消息（aura-music 会接收并执行） */
function sendControl(action) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("[desktop-lyrics] WS not open, control dropped:", action);
    return;
  }
  try {
    ws.send(JSON.stringify({ type: "control", action }));
  } catch (e) {
    console.warn("[desktop-lyrics] send control failed:", e);
  }
}

// ============== Tauri API ==============

async function tauriInvoke(cmd, args = {}) {
  if (window.__TAURI__ && window.__TAURI__.core) {
    return window.__TAURI__.core.invoke(cmd, args);
  }
  console.warn("[desktop-lyrics] __TAURI__ not available, invoke skipped:", cmd);
  return null;
}

function getTauriWindow() {
  if (window.__TAURI__ && window.__TAURI__.window) {
    return window.__TAURI__.window.getCurrentWindow();
  }
  if (window.__TAURI__ && window.__TAURI__.webviewWindow) {
    return window.__TAURI__.webviewWindow.getCurrentWebviewWindow();
  }
  return null;
}

async function listenNativeEvents() {
  if (window.__TAURI__ && window.__TAURI__.event) {
    await window.__TAURI__.event.listen("passthrough-changed", (event) => {
      const passthrough = !!event.payload;
      applyPassthroughState(passthrough);
      if (passthrough) {
        showPassthroughToast();
      }
    });
  }
}

// ============== 按钮处理 ==============

/**
 * 切换鼠标穿透。
 * set_ignore_cursor_events 只影响鼠标 hit-test，不影响键盘事件。
 * P 的退出穿透由 Tauri 原生全局快捷键兜底，窗口失焦后仍可生效。
 * 另外可通过 aura-music 顶栏开关或 HTTP /quit 关闭窗口。
 */
function applyPassthroughState(v) {
  state.passthrough = v;
  elApp.dataset.passthrough = v ? "true" : "false";
  const btnPassthrough = document.getElementById("btn-passthrough");
  if (btnPassthrough) {
    btnPassthrough.classList.toggle("active", v);
    btnPassthrough.textContent = v ? "穿透中" : "穿透";
  }
  if (!v) hidePassthroughToast();
}

function showPassthroughToast() {
  if (!elPassthroughToast) return;
  if (passthroughToastTimer) clearTimeout(passthroughToastTimer);
  elPassthroughToast.classList.add("is-visible");
  passthroughToastTimer = setTimeout(() => {
    hidePassthroughToast();
  }, 2600);
}

function hidePassthroughToast() {
  if (passthroughToastTimer) {
    clearTimeout(passthroughToastTimer);
    passthroughToastTimer = null;
  }
  if (elPassthroughToast) {
    elPassthroughToast.classList.remove("is-visible");
  }
}

async function setPassthrough(v) {
  const previous = state.passthrough;
  applyPassthroughState(v);
  try {
    await tauriInvoke("cmd_set_cursor_passthrough", { passthrough: v });
    if (v) showPassthroughToast();
  } catch (e) {
    console.warn("[desktop-lyrics] 切换穿透失败:", e);
    applyPassthroughState(previous);
  }
}

function adjustFontSize(delta) {
  state.fontSize = Math.max(14, Math.min(60, state.fontSize + delta));
  document.documentElement.style.setProperty("--font-size", state.fontSize + "px");
}

function jumpLine(offset) {
  if (state.lines.length === 0) return;
  let target = state.currentIdx + offset;
  target = Math.max(0, Math.min(state.lines.length - 1, target));
  if (target < 0) return;
  state.currentTime = state.lines[target].time;
  render(true);
}

async function quitApp() {
  // 通知 aura-music 桌面歌词已关闭（可选）
  sendControl("quit");
  const w = getTauriWindow();
  if (w) {
    try { await w.close(); } catch (e) { console.warn(e); window.close(); }
  } else {
    window.close();
  }
}

// 绑定按钮
document.getElementById("btn-close").addEventListener("click", quitApp);

document.getElementById("btn-prev-track").addEventListener("click", () => sendControl("prev"));
document.getElementById("btn-play-pause").addEventListener("click", () => {
  sendControl(state.isPlaying ? "pause" : "play");
});
document.getElementById("btn-next-track").addEventListener("click", () => sendControl("next"));

document.getElementById("btn-passthrough").addEventListener("click", () => {
  setPassthrough(!state.passthrough);
});
document.getElementById("btn-smaller").addEventListener("click", () => adjustFontSize(-2));
document.getElementById("btn-bigger").addEventListener("click", () => adjustFontSize(2));
document.getElementById("btn-prev").addEventListener("click", () => jumpLine(-1));
document.getElementById("btn-next").addEventListener("click", () => jumpLine(1));

// 拖动窗口（按住任意非按钮区域拖动）
elApp.addEventListener("mousedown", async (e) => {
  if (e.target.closest("button")) return;
  if (state.passthrough) return;

  const w = getTauriWindow();
  if (!w) {
    console.warn("[desktop-lyrics] 无法拖动: Tauri window API 不可用");
    return;
  }
  try {
    await w.startDragging();
  } catch (err) {
    console.warn("[desktop-lyrics] startDragging 失败:", err);
  }
});

// 滚轮调整字号
elApp.addEventListener("wheel", (e) => {
  if (state.passthrough) return;
  e.preventDefault();
  adjustFontSize(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// 快捷键
document.addEventListener("keydown", (e) => {
  switch (e.key) {
    case "ArrowLeft": jumpLine(-1); break;
    case "ArrowRight": jumpLine(1); break;
    case " ": case "Spacebar":
      e.preventDefault();
      sendControl(state.isPlaying ? "pause" : "play");
      break;
    case "+": case "=": adjustFontSize(2); break;
    case "-": adjustFontSize(-2); break;
    case "p": case "P":
      e.preventDefault();
      setPassthrough(!state.passthrough);
      break;
    case "Escape":
      // 穿透模式下 Esc 先关闭穿透（不退出），非穿透模式 Esc 退出
      if (state.passthrough) {
        setPassthrough(false);
      } else {
        quitApp();
      }
      break;
  }
});

// 启动
connect();
listenNativeEvents();
updatePlayPauseIcon();
