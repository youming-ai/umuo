//! 「连按两下修饰键」快捷键（⌃⌃、⌥⌥、右⌘⌘）的接线。
//!
//! 三段：平台层（`umuo_platform::ModifierMonitor`）报修饰键的按下 / 松开 →
//! 内核的状态机（`umuo_core::hotkey::DoubleTapDetector`）判定连按 →
//! 找到绑定的功能，回到主线程执行（与普通快捷键一样，暂停或录键期间不响应）。
//!
//! 监听只在**真的有连按快捷键**时才启动：全用普通组合键的用户不需要多开一个键盘监听。

use std::sync::Mutex;
use std::time::Instant;

use tauri::{AppHandle, Emitter, Manager};
use umuo_core::hotkey::{DoubleTap, DoubleTapDetector, ModKey, ModKind, Side, TapInput};
use umuo_platform::{
    ModifierEvent, ModifierKind, ModifierMonitor, ModifierSide, PhysicalModifier, PlatformError,
};

use crate::AppState;

/// 一条连按快捷键绑定。
pub struct Binding {
    pub tap: DoubleTap,
    /// 设置字段名（注册失败时按它标到设置页对应那一行）。
    pub field: &'static str,
    pub handler: fn(&AppHandle),
}

/// 当前生效的绑定。改快捷键时整体替换；监听本身不重建。
static BINDINGS: Mutex<Vec<Binding>> = Mutex::new(Vec::new());
/// 监听是否已经启动成功。**只记成功**：缺权限导致的失败要允许在用户授权后重试——
/// 把失败也缓存住的话，授完权再改快捷键也启用不了，只能重启客户端。
static STARTED: Mutex<bool> = Mutex::new(false);

/// 替换连按绑定；有绑定而监听还没启动时启动它。启动失败（多半是缺权限）返回原因。
pub fn set_bindings(app: &AppHandle, bindings: Vec<Binding>) -> Result<(), String> {
    let needed = !bindings.is_empty();
    *BINDINGS.lock().expect("连按绑定锁不应中毒") = bindings;
    if !needed {
        return Ok(());
    }
    start(app)
}

/// 之前因缺权限没启动起来、现在用户授了权：补启动监听，并把连按那几行的失败标记清掉。
///
/// 新装用户的默认划词键就是 ⌃⌃——启动时多半还没授权，监听起不来；授完权不补这一下，
/// 就得改一次快捷键或重启客户端才能用。由「检查辅助功能权限」的命令在授权后调用。
pub fn retry_start(app: &AppHandle) {
    let fields: Vec<&'static str> = {
        let bindings = BINDINGS.lock().expect("连按绑定锁不应中毒");
        bindings.iter().map(|binding| binding.field).collect()
    };
    if fields.is_empty() || *STARTED.lock().expect("连按监听锁不应中毒") {
        return;
    }
    if start(app).is_err() {
        return;
    }
    if let Some(state) = app.try_state::<AppState>() {
        state
            .hotkey_failures
            .lock()
            .expect("快捷键失败锁不应中毒")
            .retain(|field| !fields.contains(&field.as_str()));
    }
    let _ = app.emit("hotkeys://registered", ());
}

/// 监听还没启动就启动它。**只记成功**（见 [`STARTED`]）。
fn start(app: &AppHandle) -> Result<(), String> {
    let mut started = STARTED.lock().expect("连按监听锁不应中毒");
    if *started {
        return Ok(());
    }
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "客户端还没初始化完".to_string())?;
    state
        .modifier_monitor
        .start(Box::new(listener(app.clone())))
        .map_err(|error| match error {
            PlatformError::PermissionDenied { .. } => {
                "缺少「辅助功能」或「输入监控」权限".to_string()
            }
            other => other.to_string(),
        })?;
    *started = true;
    Ok(())
}

/// 监听线程上的回调：喂给判定器，凑成连按就找绑定、回主线程执行。
fn listener(app: AppHandle) -> impl Fn(ModifierEvent) + Send + 'static {
    let detector = Mutex::new(DoubleTapDetector::new());
    let epoch = Instant::now();
    move |event| {
        let input = tap_input(event);
        let now = epoch.elapsed().as_millis() as u64;
        let Some(key) = detector
            .lock()
            .expect("连按判定器锁不应中毒")
            .feed(input, now)
        else {
            return;
        };
        let handler = BINDINGS
            .lock()
            .expect("连按绑定锁不应中毒")
            .iter()
            .find(|binding| binding.tap.matches(key))
            .map(|binding| binding.handler);
        if let Some(handler) = handler {
            let target = app.clone();
            let _ = app.run_on_main_thread(move || {
                if !crate::hotkeys_suspended(&target) {
                    handler(&target);
                }
            });
        }
    }
}

/// 平台事件 → 内核的判定输入。
pub fn tap_input(event: ModifierEvent) -> TapInput {
    let key = |modifier: PhysicalModifier| ModKey {
        kind: match modifier.kind {
            ModifierKind::Ctrl => ModKind::Ctrl,
            ModifierKind::Alt => ModKind::Alt,
            ModifierKind::Shift => ModKind::Shift,
            ModifierKind::Cmd => ModKind::Cmd,
        },
        side: match modifier.side {
            ModifierSide::Left => Side::Left,
            ModifierSide::Right => Side::Right,
        },
    };
    match event {
        ModifierEvent::Down(modifier) => TapInput::Down(key(modifier)),
        ModifierEvent::Up(modifier) => TapInput::Up(key(modifier)),
        ModifierEvent::Other => TapInput::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_events_map_onto_core_inputs() {
        let right_cmd = PhysicalModifier {
            kind: ModifierKind::Cmd,
            side: ModifierSide::Right,
        };
        assert_eq!(
            tap_input(ModifierEvent::Down(right_cmd)),
            TapInput::Down(ModKey {
                kind: ModKind::Cmd,
                side: Side::Right
            })
        );
        assert_eq!(tap_input(ModifierEvent::Other), TapInput::Other);
    }
}
