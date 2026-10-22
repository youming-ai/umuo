//! 设置里的快捷键与 Tauri 全局快捷键插件的契约。
//!
//! `Settings` 已搬进 `umuo-app`（不依赖 Tauri），而这条测试要用插件自己的解析器，所以留在外壳里。

use tauri_plugin_global_shortcut::Shortcut;

/// 设置窗的录键器只会产出这些按键名（`apps/desktop/src/lib/hotkey-format.ts` 的 `RECORDABLE_KEYS`）。
/// 每一个都必须能被全局快捷键插件解析——否则录下来的键会在注册时静默回落到默认键位。
#[test]
fn every_key_the_recorder_can_emit_is_parseable() {
    let mut keys: Vec<String> = ('A'..='Z').chain('0'..='9').map(String::from).collect();
    keys.extend((1..=12).map(|n| format!("F{n}")));
    keys.extend(
        [
            "Space",
            "Enter",
            "Tab",
            "Comma",
            "Period",
            "Slash",
            "Semicolon",
            "Quote",
            "BracketLeft",
            "BracketRight",
            "Backslash",
            "Minus",
            "Equal",
            "Backquote",
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
        ]
        .map(String::from),
    );
    for key in keys {
        for combo in [format!("Alt+{key}"), format!("Ctrl+Alt+Shift+Cmd+{key}")] {
            assert!(
                combo.parse::<Shortcut>().is_ok(),
                "录键器会产出 {combo}，但插件解析不了"
            );
        }
    }
}
