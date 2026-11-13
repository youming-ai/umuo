//! 快捷键的纯规则导出（`umuo_core::hotkey`）：`parse_hotkey` 分流、组合键语法 `parse_combo` / `normalize_combo`，
//! 以及连按两下修饰键的判定器。
//!
//! 只做换型。修饰键事件的来源（CGEventTap）与组合键的注册（Carbon）是平台能力，留在 Swift 里；
//! 「是不是连按了两下」是内核的状态机，有测试，Swift 不重写一份。

use std::sync::Mutex;

use umuo_core::hotkey as core;

/// 修饰键的种类。
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ModKind {
    Ctrl,
    Alt,
    Shift,
    Cmd,
}

/// 左右两侧。
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum Side {
    Left,
    Right,
}

/// 一个物理修饰键（例如「右 ⌘」）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct ModKey {
    pub kind: ModKind,
    pub side: Side,
}

/// 一个「连按两下」快捷键。`side` 为空时左右两侧都算（但两下必须是同一个物理键）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct DoubleTap {
    pub kind: ModKind,
    pub side: Option<Side>,
}

/// 一条快捷键设置解析出来是什么。
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum HotkeySpec {
    /// 普通组合键（`Alt+D`），交给系统注册；`value` 已去掉首尾空白。
    Combo { value: String },
    /// 连按两下修饰键（`Ctrl Ctrl`）。
    DoubleTap { tap: DoubleTap },
}

/// 喂给判定器的事件。
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum TapInput {
    Down {
        key: ModKey,
    },
    Up {
        key: ModKey,
    },
    /// 其它按键或鼠标点击——打断正在进行的连按。
    Other,
}

impl From<core::ModKind> for ModKind {
    fn from(kind: core::ModKind) -> Self {
        match kind {
            core::ModKind::Ctrl => Self::Ctrl,
            core::ModKind::Alt => Self::Alt,
            core::ModKind::Shift => Self::Shift,
            core::ModKind::Cmd => Self::Cmd,
        }
    }
}

impl From<ModKind> for core::ModKind {
    fn from(kind: ModKind) -> Self {
        match kind {
            ModKind::Ctrl => Self::Ctrl,
            ModKind::Alt => Self::Alt,
            ModKind::Shift => Self::Shift,
            ModKind::Cmd => Self::Cmd,
        }
    }
}

impl From<core::Side> for Side {
    fn from(side: core::Side) -> Self {
        match side {
            core::Side::Left => Self::Left,
            core::Side::Right => Self::Right,
        }
    }
}

impl From<Side> for core::Side {
    fn from(side: Side) -> Self {
        match side {
            Side::Left => Self::Left,
            Side::Right => Self::Right,
        }
    }
}

impl From<core::ModKey> for ModKey {
    fn from(key: core::ModKey) -> Self {
        Self {
            kind: key.kind.into(),
            side: key.side.into(),
        }
    }
}

impl From<ModKey> for core::ModKey {
    fn from(key: ModKey) -> Self {
        Self {
            kind: key.kind.into(),
            side: key.side.into(),
        }
    }
}

impl From<DoubleTap> for core::DoubleTap {
    fn from(tap: DoubleTap) -> Self {
        Self {
            kind: tap.kind.into(),
            side: tap.side.map(Into::into),
        }
    }
}

impl From<TapInput> for core::TapInput {
    fn from(input: TapInput) -> Self {
        match input {
            TapInput::Down { key } => Self::Down(key.into()),
            TapInput::Up { key } => Self::Up(key.into()),
            TapInput::Other => Self::Other,
        }
    }
}

/// 解析一条快捷键设置。不是「同一个修饰键写两遍」的，一律当普通组合键。
#[uniffi::export]
pub fn parse_hotkey(value: String) -> HotkeySpec {
    match core::parse_hotkey(&value) {
        core::HotkeySpec::Combo(value) => HotkeySpec::Combo { value },
        core::HotkeySpec::DoubleTap(tap) => HotkeySpec::DoubleTap {
            tap: DoubleTap {
                kind: tap.kind.into(),
                side: tap.side.map(Into::into),
            },
        },
    }
}

/// 普通组合键解析出来的修饰键与主键（W3C `code` 名）。换算成 Carbon 键码由 Swift 做。
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Combo {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub cmd: bool,
    pub code: String,
}

impl From<core::Combo> for Combo {
    fn from(combo: core::Combo) -> Self {
        let core::Combo {
            ctrl,
            alt,
            shift,
            cmd,
            code,
        } = combo;
        Self {
            ctrl,
            alt,
            shift,
            cmd,
            code,
        }
    }
}

/// 解析普通组合键（`Alt+D`）；不合法返回空。语法见 `umuo_core::hotkey::parse_combo`。
#[uniffi::export]
pub fn parse_combo(value: String) -> Option<Combo> {
    core::parse_combo(&value).map(Into::into)
}

/// 冲突检查用的规范写法（`umuo_core::hotkey::normalize_combo`）。
#[uniffi::export]
pub fn normalize_combo(value: String) -> String {
    core::normalize_combo(&value)
}

/// 这一次连按（落在某个物理键上）是否触发这条快捷键。
#[uniffi::export]
pub fn double_tap_matches(tap: DoubleTap, key: ModKey) -> bool {
    core::DoubleTap::from(tap).matches(key.into())
}

/// 连按两下的判定器（规则见 `umuo_core::hotkey::DoubleTapDetector`）。时间由调用方给，单位毫秒、单调递增。
#[derive(uniffi::Object, Default)]
pub struct DoubleTapDetector(Mutex<core::DoubleTapDetector>);

#[uniffi::export]
impl DoubleTapDetector {
    #[uniffi::constructor]
    pub fn new() -> Self {
        Self::default()
    }

    /// 喂一个事件；凑成了连按两下就返回那个物理键。
    pub fn feed(&self, input: TapInput, now_ms: u64) -> Option<ModKey> {
        self.0
            .lock()
            .expect("连按判定器锁不应中毒")
            .feed(input.into(), now_ms)
            .map(Into::into)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LCTRL: ModKey = ModKey {
        kind: ModKind::Ctrl,
        side: Side::Left,
    };

    #[test]
    fn parse_matches_the_core() {
        assert_eq!(
            parse_hotkey("rightcmd RightCmd".into()),
            HotkeySpec::DoubleTap {
                tap: DoubleTap {
                    kind: ModKind::Cmd,
                    side: Some(Side::Right)
                }
            }
        );
        assert_eq!(
            parse_hotkey(" Alt+D ".into()),
            HotkeySpec::Combo {
                value: "Alt+D".into()
            }
        );
        let any_ctrl = DoubleTap {
            kind: ModKind::Ctrl,
            side: None,
        };
        assert!(double_tap_matches(any_ctrl, LCTRL));
        assert!(!double_tap_matches(
            DoubleTap {
                side: Some(Side::Right),
                ..any_ctrl
            },
            LCTRL
        ));
    }

    #[test]
    fn combos_match_the_core() {
        assert_eq!(
            parse_combo("Option+Shift+Up".into()),
            Some(Combo {
                ctrl: false,
                alt: true,
                shift: true,
                cmd: false,
                code: "ArrowUp".into()
            })
        );
        assert_eq!(parse_combo("Ctrl++D".into()), None);
        assert_eq!(normalize_combo(" Cmd+Option+Esc ".into()), "alt+cmd+escape");
    }

    #[test]
    fn detector_triggers_on_two_quick_taps() {
        let detector = DoubleTapDetector::new();
        let mut hits = Vec::new();
        for (input, at) in [
            (TapInput::Down { key: LCTRL }, 0),
            (TapInput::Up { key: LCTRL }, 60),
            (TapInput::Down { key: LCTRL }, 200),
            (TapInput::Up { key: LCTRL }, 260),
        ] {
            hits.extend(detector.feed(input, at));
        }
        assert_eq!(hits, [LCTRL]);
    }
}
