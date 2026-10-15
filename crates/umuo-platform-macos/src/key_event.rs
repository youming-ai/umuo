//! 合成快捷键事件（模拟 ⌘C / ⌘V）。
//!
//! 用 CGEvent 直接投递到 HID 层，而不是走 AppleScript：后者要额外权限、
//! 延迟高、在沙盒/无脚本权限的环境里会静默失败。
//!
//! 注意：合成键盘事件本身也需要辅助功能权限——所以它不是「避开权限」的办法，
//! 而是「AX 读不到选区时」的替代数据通路。

use std::time::Duration;

use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

use umuo_platform::PlatformError;

/// `kVK_ANSI_C`
const KEY_C: u16 = 8;
/// `kVK_ANSI_V`
const KEY_V: u16 = 9;

/// 按下 ⌘C。
pub fn copy() -> Result<(), PlatformError> {
    send_command_key(KEY_C)
}

/// 按下 ⌘V。
pub fn paste() -> Result<(), PlatformError> {
    send_command_key(KEY_V)
}

fn send_command_key(key_code: u16) -> Result<(), PlatformError> {
    // 两次事件各用一个 source：CGEventSource 的所有权是转移的，
    // 复用需要 clone，而重新建一个更便宜也更不容易出错。
    for key_down in [true, false] {
        let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
            .map_err(|_| PlatformError::Other("无法创建键盘事件源".to_string()))?;
        let event = CGEvent::new_keyboard_event(source, key_code, key_down)
            .map_err(|_| PlatformError::Other("无法创建键盘事件".to_string()))?;
        event.set_flags(CGEventFlags::CGEventFlagCommand);
        event.post(CGEventTapLocation::HID);
    }
    // 给目标 App 一点时间把复制结果写进剪贴板；太快轮询会以为「没复制成功」，
    // 于是白白走一遍超时。
    std::thread::sleep(Duration::from_millis(60));
    Ok(())
}
