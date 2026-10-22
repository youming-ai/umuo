//! 修饰键监听的 macOS 实现（[`umuo_platform::ModifierMonitor`]）。
//!
//! 系统的全局快捷键只能注册「修饰键 + 主键」，⌃⌃ 这种只按修饰键的组合注册不了，
//! 所以这里开一个**只读**的事件监听（CGEventTap，ListenOnly）：只看、不拦、不改，
//! 按键照常送到前台应用。
//!
//! 监听跑在自己的线程上，带一个 CFRunLoop。macOS 在回调太慢或用户输入特殊情况下会
//! 自动停用监听（TapDisabledByTimeout / ByUserInput），收到这两个通知时立刻重新启用——
//! 否则连按快捷键会在某次卡顿后悄悄失灵，而且没有任何报错。

use std::cell::RefCell;
use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicPtr, Ordering};
use std::sync::{mpsc, Arc};

use core_foundation::base::TCFType;
use core_foundation::mach_port::CFMachPortRef;
use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
use core_graphics::event::{
    CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType, EventField,
};
use umuo_platform::{
    ModifierEvent, ModifierKind, ModifierMonitor, ModifierSide, PhysicalModifier, PlatformError,
};

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
}

/// macOS 的修饰键监听。
#[derive(Debug, Default)]
pub struct MacModifierMonitor;

impl MacModifierMonitor {
    pub fn new() -> Self {
        Self
    }
}

impl ModifierMonitor for MacModifierMonitor {
    fn start(
        &self,
        on_event: Box<dyn Fn(ModifierEvent) + Send + 'static>,
    ) -> Result<(), PlatformError> {
        start_tap(on_event)
    }
}

/// macOS 虚拟键码（kVK_*）与对应的「设备相关」标志位（NX_DEVICE*KEYMASK）。
/// 用设备相关位而不是通用的 ⌃/⌥ 位判断按下还是松开：左右两侧同时按着时，
/// 通用位分不出松开的是哪一边。
const MODIFIER_KEYS: [(u16, ModifierKind, ModifierSide, u64); 8] = [
    (0x3B, ModifierKind::Ctrl, ModifierSide::Left, 0x0000_0001),
    (0x3E, ModifierKind::Ctrl, ModifierSide::Right, 0x0000_2000),
    (0x38, ModifierKind::Shift, ModifierSide::Left, 0x0000_0002),
    (0x3C, ModifierKind::Shift, ModifierSide::Right, 0x0000_0004),
    (0x37, ModifierKind::Cmd, ModifierSide::Left, 0x0000_0008),
    (0x36, ModifierKind::Cmd, ModifierSide::Right, 0x0000_0010),
    (0x3A, ModifierKind::Alt, ModifierSide::Left, 0x0000_0020),
    (0x3D, ModifierKind::Alt, ModifierSide::Right, 0x0000_0040),
];

/// 一次「修饰键状态变化」→ 哪个物理键按下或松开。fn、Caps Lock 等不参与连按的键返回 `None`。
pub fn modifier_event(keycode: u16, flags: u64) -> Option<ModifierEvent> {
    let (_, kind, side, bit) = MODIFIER_KEYS.iter().find(|(code, ..)| *code == keycode)?;
    let key = PhysicalModifier {
        kind: *kind,
        side: *side,
    };
    Some(if flags & bit != 0 {
        ModifierEvent::Down(key)
    } else {
        ModifierEvent::Up(key)
    })
}

/// 按设备相关位算出现在按着的所有物理修饰键。
fn held_keys(flags: u64) -> Vec<PhysicalModifier> {
    MODIFIER_KEYS
        .iter()
        .filter(|(.., bit)| flags & bit != 0)
        .map(|(_, kind, side, _)| PhysicalModifier {
            kind: *kind,
            side: *side,
        })
        .collect()
}

/// 一次 FlagsChanged → 喂给判定器的事件，以及之后「按着的键」。
///
/// 只报 keycode 那一个键的话，丢一次松开事件（⌃⌘Q 锁屏、切到安全输入框、监听被系统停用期间）
/// 判定器就会以为那个键一直按着，之后所有连按都被当成「组合」——直到用户碰巧再按一次那个键。
/// 所以每次都按事件里的**完整** flags 对一遍账：上次记着按下、这次已经不在的，补发松开；
/// 反过来补发按下。keycode 自己的那次变化放在最后。纯函数，便于测试。
pub fn reconcile(
    previous: &[PhysicalModifier],
    keycode: u16,
    flags: u64,
) -> (Vec<ModifierEvent>, Vec<PhysicalModifier>) {
    let now = held_keys(flags);
    let own = modifier_event(keycode, flags);
    let is_own = |key: &PhysicalModifier| matches!(own, Some(ModifierEvent::Down(k) | ModifierEvent::Up(k)) if k == *key);
    let mut events: Vec<ModifierEvent> = previous
        .iter()
        .filter(|key| !now.contains(key) && !is_own(key))
        .map(|key| ModifierEvent::Up(*key))
        .collect();
    events.extend(
        now.iter()
            .filter(|key| !previous.contains(key) && !is_own(key))
            .map(|key| ModifierEvent::Down(*key)),
    );
    // 修饰键不会自动重复：记着按下的键又来一次「按下」，说明它的松开丢了，先补上。
    if let Some(ModifierEvent::Down(key)) = own {
        if previous.contains(&key) {
            events.push(ModifierEvent::Up(key));
        }
    }
    events.extend(own);
    (events, now)
}

fn start_tap(on_event: Box<dyn Fn(ModifierEvent) + Send + 'static>) -> Result<(), PlatformError> {
    let (ready, outcome) = mpsc::channel::<Result<(), PlatformError>>();
    std::thread::Builder::new()
        .name("umuo-modifier-tap".into())
        .spawn(move || {
            // 回调里要能拿到监听本身的端口来重新启用它，而端口在创建之后才有：用一个原子指针中转。
            let port: Arc<AtomicPtr<c_void>> = Arc::new(AtomicPtr::new(ptr::null_mut()));
            let port_in_callback = Arc::clone(&port);
            // 上一次看到的「按着的键」，用来对账（见 [`reconcile`]）。回调只在这个线程上跑。
            let held: RefCell<Vec<PhysicalModifier>> = RefCell::new(Vec::new());
            let tap = CGEventTap::new(
                CGEventTapLocation::Session,
                CGEventTapPlacement::HeadInsertEventTap,
                CGEventTapOptions::ListenOnly,
                vec![
                    CGEventType::FlagsChanged,
                    CGEventType::KeyDown,
                    CGEventType::LeftMouseDown,
                    CGEventType::RightMouseDown,
                    CGEventType::OtherMouseDown,
                ],
                move |_proxy, event_type, event| {
                    match event_type {
                        CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput => {
                            let raw = port_in_callback.load(Ordering::Acquire);
                            if !raw.is_null() {
                                // SAFETY: raw 是这个监听自己的 CFMachPort，在监听线程存活期间一直有效。
                                unsafe { CGEventTapEnable(raw as CFMachPortRef, true) };
                            }
                            // 停用期间的松开事件都丢了：把记着的键全部当作松开，下一次
                            // FlagsChanged 会按真实的 flags 再对一遍。
                            for key in held.take() {
                                on_event(ModifierEvent::Up(key));
                            }
                        }
                        CGEventType::FlagsChanged => {
                            let keycode = event
                                .get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE)
                                as u16;
                            let (changes, now) =
                                reconcile(&held.borrow(), keycode, event.get_flags().bits());
                            *held.borrow_mut() = now;
                            for change in changes {
                                on_event(change);
                            }
                        }
                        _ => on_event(ModifierEvent::Other),
                    }
                    // 只读监听：返回值不影响事件本身
                    None
                },
            );
            let tap = match tap {
                Ok(tap) => tap,
                Err(()) => {
                    // 创建失败几乎总是缺权限（只读键盘监听需要「辅助功能」或「输入监控」）。
                    let _ = ready.send(Err(PlatformError::PermissionDenied {
                        capability: "input-monitoring",
                    }));
                    return;
                }
            };
            let source = match tap.mach_port.create_runloop_source(0) {
                Ok(source) => source,
                Err(()) => {
                    let _ = ready.send(Err(PlatformError::Other(
                        "无法为修饰键监听创建事件源".to_string(),
                    )));
                    return;
                }
            };
            port.store(
                tap.mach_port.as_concrete_TypeRef() as *mut c_void,
                Ordering::Release,
            );
            // SAFETY: kCFRunLoopCommonModes 是 CoreFoundation 导出的常量。
            CFRunLoop::get_current().add_source(&source, unsafe { kCFRunLoopCommonModes });
            tap.enable();
            let _ = ready.send(Ok(()));
            // 一直跑到进程退出；`tap` 与 `source` 留在这个栈帧里，保证监听期间不被释放。
            CFRunLoop::run_current();
        })
        .map_err(|error| PlatformError::Other(format!("无法启动修饰键监听线程：{error}")))?;
    outcome
        .recv()
        .unwrap_or_else(|_| Err(PlatformError::Other("修饰键监听线程意外退出".to_string())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_left_and_right_modifiers_by_keycode_and_device_bit() {
        // 通用 ⌘ 位 + 右 ⌘ 设备位：右 ⌘ 按下
        assert_eq!(
            modifier_event(0x36, 0x0010_0010),
            Some(ModifierEvent::Down(PhysicalModifier {
                kind: ModifierKind::Cmd,
                side: ModifierSide::Right
            }))
        );
        // 左 ⌘ 还按着、右 ⌘ 松开：通用 ⌘ 位仍在，但右 ⌘ 的设备位没了——要判成「右 ⌘ 松开」
        assert_eq!(
            modifier_event(0x36, 0x0010_0008),
            Some(ModifierEvent::Up(PhysicalModifier {
                kind: ModifierKind::Cmd,
                side: ModifierSide::Right
            }))
        );
    }

    const LCTRL: PhysicalModifier = PhysicalModifier {
        kind: ModifierKind::Ctrl,
        side: ModifierSide::Left,
    };
    const LCMD: PhysicalModifier = PhysicalModifier {
        kind: ModifierKind::Cmd,
        side: ModifierSide::Left,
    };

    #[test]
    fn a_lost_release_is_made_up_from_the_full_flags() {
        // ⌃⌘Q 锁屏：⌘ 的松开没送到，上次记着 [左⌃, 左⌘]。解锁后按左 ⌃，
        // flags 里只有左 ⌃ 的位——要先补一个「左 ⌘ 松开」，判定器才不会以为还在组合。
        let (events, now) = reconcile(&[LCMD], 0x3B, 0x0004_0001);
        assert_eq!(
            events,
            [ModifierEvent::Up(LCMD), ModifierEvent::Down(LCTRL)]
        );
        assert_eq!(now, [LCTRL]);
    }

    #[test]
    fn pressing_a_key_that_is_still_remembered_as_held_releases_it_first() {
        // 左 ⌃ 的松开丢了，再按左 ⌃：先补松开再报按下，这一下就能算数。
        let (events, _) = reconcile(&[LCTRL], 0x3B, 0x0004_0001);
        assert_eq!(
            events,
            [ModifierEvent::Up(LCTRL), ModifierEvent::Down(LCTRL)]
        );
    }

    #[test]
    fn an_ordinary_change_reports_just_that_key() {
        let (events, now) = reconcile(&[], 0x3B, 0x0004_0001);
        assert_eq!(events, [ModifierEvent::Down(LCTRL)]);
        assert_eq!(now, [LCTRL]);
        let (events, now) = reconcile(&now, 0x3B, 0);
        assert_eq!(events, [ModifierEvent::Up(LCTRL)]);
        assert!(now.is_empty());
    }

    #[test]
    fn keys_that_do_not_take_part_are_ignored() {
        // fn（0x3F）与 Caps Lock（0x39）不参与连按
        for keycode in [0x3F, 0x39] {
            assert_eq!(modifier_event(keycode, 0), None);
        }
    }
}
