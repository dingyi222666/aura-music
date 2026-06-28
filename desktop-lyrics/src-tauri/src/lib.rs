// Aura Desktop Lyrics — Tauri 主进程
// 仅做最少的原生工作：创建透明置顶窗口、鼠标穿透切换、穿透退出热键。
// 真正的歌词渲染在 WebView 里完成（src/index.html + src/main.js）。

use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};

const PASSTHROUGH_EXIT_SHORTCUT: &str = "P";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|_app| {
            // 启动时无需特别处理，前端会自动连接 WS
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_set_cursor_passthrough
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 切换鼠标穿透：true=点击穿透到下层窗口，false=可交互（拖动/调字号）。
/// 注意：set_ignore_cursor_events 只影响鼠标 hit-test，不影响键盘事件。
/// 穿透开启时注册全局 P 热键，窗口失焦后也可退出穿透。
#[tauri::command]
fn cmd_set_cursor_passthrough(window: tauri::WebviewWindow, passthrough: bool) -> Result<(), String> {
    let app = window.app_handle();

    if passthrough {
        register_passthrough_exit_shortcut(app)?;
        window.set_ignore_cursor_events(true).map_err(|e| e.to_string())
    } else {
        window.set_ignore_cursor_events(false).map_err(|e| e.to_string())?;
        unregister_passthrough_exit_shortcut(app)?;
        Ok(())
    }
}

fn register_passthrough_exit_shortcut(app: &tauri::AppHandle) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    if shortcuts.is_registered(PASSTHROUGH_EXIT_SHORTCUT) {
        return Ok(());
    }

    shortcuts
        .on_shortcut(PASSTHROUGH_EXIT_SHORTCUT, |app, shortcut, event| {
            if event.state != ShortcutState::Pressed
                || !shortcut.matches(Modifiers::empty(), Code::KeyP)
            {
                return;
            }

            let app = app.clone();
            std::thread::spawn(move || {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_ignore_cursor_events(false);
                    let _ = window.set_focus();
                }
                let _ = app.global_shortcut().unregister(PASSTHROUGH_EXIT_SHORTCUT);
                let _ = app.emit("passthrough-changed", false);
            });
        })
        .map_err(|e| e.to_string())
}

fn unregister_passthrough_exit_shortcut(app: &tauri::AppHandle) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    if shortcuts.is_registered(PASSTHROUGH_EXIT_SHORTCUT) {
        shortcuts
            .unregister(PASSTHROUGH_EXIT_SHORTCUT)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
