# Aura Desktop Lyrics

桌面歌词窗口（透明 + 置顶 + 双语渲染），与 Aura Music Web 播放器通过 WebSocket 同步。

## 架构

```
aura-music (浏览器 :3000)
   ↓ 推送当前歌曲歌词/进度
lyric-overlay-server (Node :8787)
   ↓ 广播
Aura Desktop Lyrics (Tauri 2 桌面窗口)
```

## 前置要求

- Rust 工具链（`rustup` 安装，含 MSVC C++ build tools）
- WebView2 Runtime（Windows 10/11 自带）
- Node.js 18+（已在用）

## 开发模式

```bash
# 1. 先启动 aura-music web 播放器 + WS server（在项目根目录跑启动脚本）
# 2. 进入本目录
cd desktop-lyrics
npm install
cargo tauri dev
```

## 构建可执行文件

```bash
cd desktop-lyrics
npm install
cargo tauri build
# 产物在 src-tauri/target/release/bundle/{nsis,msi}/
```

## 操作说明

| 操作 | 效果 |
|---|---|
| 鼠标拖动窗口 | 移动位置 |
| 滚轮 | 调整字号 |
| `←` / `→` | 上一句 / 下一句歌词 |
| `+` / `-` | 放大 / 缩小字号 |
| `P` | 切换鼠标穿透（穿透时点击穿过到下层窗口） |
| `Esc` | 退出 |

## 自定义

- 字号范围：编辑 `src/main.js` 中 `adjustFontSize` 的 `Math.max(14, Math.min(60, ...))`
- 默认窗口大小/位置：编辑 `src-tauri/tauri.conf.json` 的 `windows[0]`
- 字体：编辑 `src/style.css` 的 `--font-family`
- 推送频率：编辑 aura-music 项目的 `hooks/useLyricOverlay.ts` 的 `POSITION_THROTTLE_MS`

## 故障排查

| 现象 | 原因 / 解决 |
|---|---|
| 窗口显示"等待 aura-music" | WS 未连上。确认 `启动AuraMusic.bat` 同时启动了 vite 和 ws server |
| 歌词不滚动 | aura-music 没有正在播放，或歌词数据为空。检查浏览器控制台 `[lyric-overlay]` 日志 |
| 窗口透明无背景 | Tauri 2 在 Windows 11 上需要 WebView2 149+，已自动满足 |
| 鼠标穿透后无法点回 | 按 `P` 键切换；或右键托盘图标（如果未来加） |
| 拖不动窗口 | 鼠标穿透模式开启时无法拖动。先按 `P` 关闭穿透 |
