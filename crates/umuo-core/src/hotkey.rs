//! 「连按两下修饰键」快捷键：解析与判定（纯逻辑，平台无关）。
//!
//! 普通组合键（`Alt+D`）交给系统的全局快捷键注册；而 ⌃⌃、⌥⌥、右⌘⌘ 这类
//! **只按修饰键**的快捷键系统注册不了，要靠平台层监听修饰键的按下与松开，
//! 再由这里的状态机判断「是不是连按了两下」。
//!
//! 存储格式：同一个修饰键名写两遍、空格分隔——`Ctrl Ctrl`、`Alt Alt`、`RightCmd RightCmd`。
//! 不带 `Left` / `Right` 前缀时左右两侧都算（但两下必须是同一个物理键）。

/// 修饰键的种类。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModKind {
    Ctrl,
    Alt,
    Shift,
    Cmd,
}

/// 左右两侧。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Left,
    Right,
}

/// 一个物理修饰键（例如「右 ⌘」）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModKey {
    pub kind: ModKind,
    pub side: Side,
}

/// 一个「连按两下」快捷键。`side` 为 `None` 时左右两侧都算。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DoubleTap {
    pub kind: ModKind,
    pub side: Option<Side>,
}

impl DoubleTap {
    /// 这一次连按（落在某个物理键上）是否触发它。
    pub fn matches(&self, key: ModKey) -> bool {
        self.kind == key.kind && self.side.is_none_or(|side| side == key.side)
    }
}

/// 一条快捷键设置解析出来是什么。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HotkeySpec {
    /// 普通组合键，原样交给系统注册（`Alt+D`）。
    Combo(String),
    /// 连按两下修饰键。
    DoubleTap(DoubleTap),
}

fn parse_modifier(token: &str) -> Option<DoubleTap> {
    let upper = token.to_ascii_uppercase();
    let (side, name) = if let Some(rest) = upper.strip_prefix("LEFT") {
        (Some(Side::Left), rest)
    } else if let Some(rest) = upper.strip_prefix("RIGHT") {
        (Some(Side::Right), rest)
    } else {
        (None, upper.as_str())
    };
    let kind = match name {
        "CTRL" | "CONTROL" => ModKind::Ctrl,
        "ALT" | "OPTION" => ModKind::Alt,
        "SHIFT" => ModKind::Shift,
        "CMD" | "COMMAND" | "SUPER" => ModKind::Cmd,
        _ => return None,
    };
    Some(DoubleTap { kind, side })
}

/// 解析一条快捷键设置。不是「同一个修饰键写两遍」的，一律当普通组合键交给系统。
pub fn parse_hotkey(value: &str) -> HotkeySpec {
    let tokens: Vec<&str> = value.split_whitespace().collect();
    if let [first, second] = tokens.as_slice() {
        if first.eq_ignore_ascii_case(second) {
            if let Some(tap) = parse_modifier(first) {
                return HotkeySpec::DoubleTap(tap);
            }
        }
    }
    HotkeySpec::Combo(value.trim().to_string())
}

/// 平台层喂给判定器的事件。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TapInput {
    /// 某个修饰键按下。
    Down(ModKey),
    /// 某个修饰键松开。
    Up(ModKey),
    /// 其它按键或鼠标点击——打断正在进行的连按。
    Other,
}

/// 一下「按」最长能按多久。按住更久说明是在用它组合别的键（例如按住 ⌃ 去点东西），不算一下。
pub const MAX_PRESS_MS: u64 = 250;
/// 两下之间最长隔多久。
pub const MAX_GAP_MS: u64 = 350;

/// 连按两下的判定器。
///
/// 只有「干净」的两下才算：
/// - 每一下都是单独按下这一个修饰键（按下时没有别的修饰键在按着）；
/// - 每一下按住不超过 [`MAX_PRESS_MS`]；
/// - 两下之间不超过 [`MAX_GAP_MS`]，并且中间没有按过别的键、点过鼠标、动过别的修饰键；
/// - 两下是同一个物理键（左 ⌃ 接右 ⌃ 不算）。
#[derive(Debug, Default)]
pub struct DoubleTapDetector {
    /// 当前按着的修饰键。
    held: Vec<ModKey>,
    /// 正在进行的这一下：哪个键、什么时候按下的。`None` 表示这一下已经不干净了。
    press: Option<(ModKey, u64)>,
    /// 上一个干净的「一下」：哪个键、什么时候松开的。
    last_tap: Option<(ModKey, u64)>,
}

impl DoubleTapDetector {
    pub fn new() -> Self {
        Self::default()
    }

    /// 喂一个事件；凑成了连按两下就返回那个物理键。
    pub fn feed(&mut self, input: TapInput, now_ms: u64) -> Option<ModKey> {
        match input {
            TapInput::Other => {
                self.press = None;
                self.last_tap = None;
                None
            }
            TapInput::Down(key) => {
                if self.held.contains(&key) {
                    // 重复的按下（自动重复等）——不改变状态
                    return None;
                }
                if !self.held.is_empty() {
                    // 按着别的修饰键时又按了一个：这是在组合，不是连按
                    self.press = None;
                    self.last_tap = None;
                } else {
                    if self.last_tap.is_some_and(|(last, _)| last != key) {
                        self.last_tap = None;
                    }
                    self.press = Some((key, now_ms));
                }
                self.held.push(key);
                None
            }
            TapInput::Up(key) => {
                self.held.retain(|held| *held != key);
                let press = self.press.take();
                let clean = press.is_some_and(|(pressed, at)| {
                    pressed == key && now_ms.saturating_sub(at) <= MAX_PRESS_MS
                });
                if !clean {
                    self.last_tap = None;
                    return None;
                }
                let pressed_at = press.map_or(now_ms, |(_, at)| at);
                match self.last_tap {
                    Some((last, released_at))
                        if last == key && pressed_at.saturating_sub(released_at) <= MAX_GAP_MS =>
                    {
                        self.last_tap = None;
                        Some(key)
                    }
                    _ => {
                        self.last_tap = Some((key, now_ms));
                        None
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LCTRL: ModKey = ModKey {
        kind: ModKind::Ctrl,
        side: Side::Left,
    };
    const RCTRL: ModKey = ModKey {
        kind: ModKind::Ctrl,
        side: Side::Right,
    };
    const RCMD: ModKey = ModKey {
        kind: ModKind::Cmd,
        side: Side::Right,
    };
    const LALT: ModKey = ModKey {
        kind: ModKind::Alt,
        side: Side::Left,
    };

    /// 按一串 (事件, 时间) 喂进去，返回所有触发。
    fn run(events: &[(TapInput, u64)]) -> Vec<ModKey> {
        let mut detector = DoubleTapDetector::new();
        events
            .iter()
            .filter_map(|(input, at)| detector.feed(*input, *at))
            .collect()
    }

    fn tap(key: ModKey, at: u64) -> [(TapInput, u64); 2] {
        [(TapInput::Down(key), at), (TapInput::Up(key), at + 60)]
    }

    #[test]
    fn parses_double_taps_and_leaves_everything_else_as_combos() {
        assert_eq!(
            parse_hotkey("Ctrl Ctrl"),
            HotkeySpec::DoubleTap(DoubleTap {
                kind: ModKind::Ctrl,
                side: None
            })
        );
        assert_eq!(
            parse_hotkey("rightcmd RightCmd"),
            HotkeySpec::DoubleTap(DoubleTap {
                kind: ModKind::Cmd,
                side: Some(Side::Right)
            })
        );
        assert_eq!(
            parse_hotkey(" option  Option "),
            HotkeySpec::DoubleTap(DoubleTap {
                kind: ModKind::Alt,
                side: None
            })
        );
        for combo in ["Alt+D", "Ctrl Alt", "Ctrl", "A A", "Ctrl Ctrl Ctrl", ""] {
            assert!(
                matches!(parse_hotkey(combo), HotkeySpec::Combo(_)),
                "{combo} 不该被当成连按"
            );
        }
    }

    #[test]
    fn side_specific_bindings_only_match_that_side() {
        let any = DoubleTap {
            kind: ModKind::Ctrl,
            side: None,
        };
        let right = DoubleTap {
            kind: ModKind::Ctrl,
            side: Some(Side::Right),
        };
        assert!(any.matches(LCTRL) && any.matches(RCTRL));
        assert!(right.matches(RCTRL) && !right.matches(LCTRL));
        assert!(!any.matches(RCMD));
    }

    #[test]
    fn two_quick_taps_trigger() {
        let mut events = tap(LCTRL, 0).to_vec();
        events.extend(tap(LCTRL, 200));
        assert_eq!(run(&events), vec![LCTRL]);
    }

    #[test]
    fn three_taps_trigger_once() {
        let mut events = tap(RCMD, 0).to_vec();
        events.extend(tap(RCMD, 150));
        events.extend(tap(RCMD, 300));
        assert_eq!(run(&events), vec![RCMD]);
    }

    #[test]
    fn holding_a_modifier_to_combine_is_not_a_tap() {
        // 按住 ⌃ 超过 250ms（例如在点东西），松开后再点一下 ⌃，不算连按
        let events = [
            (TapInput::Down(LCTRL), 0),
            (TapInput::Up(LCTRL), 400),
            (TapInput::Down(LCTRL), 500),
            (TapInput::Up(LCTRL), 560),
        ];
        assert!(run(&events).is_empty());
    }

    #[test]
    fn a_key_press_in_between_breaks_it() {
        // ⌃C 之后马上再按一下 ⌃：中间有别的键，不算
        let events = [
            (TapInput::Down(LCTRL), 0),
            (TapInput::Other, 40),
            (TapInput::Up(LCTRL), 80),
            (TapInput::Down(LCTRL), 200),
            (TapInput::Up(LCTRL), 260),
        ];
        assert!(run(&events).is_empty());

        let mut events = tap(LCTRL, 0).to_vec();
        events.push((TapInput::Other, 100)); // 两下之间点了鼠标
        events.extend(tap(LCTRL, 150));
        assert!(run(&events).is_empty());
    }

    #[test]
    fn too_slow_between_taps_does_not_trigger() {
        let mut events = tap(LCTRL, 0).to_vec();
        events.extend(tap(LCTRL, 600));
        assert!(run(&events).is_empty());
    }

    #[test]
    fn combining_modifiers_is_not_a_tap() {
        // ⌥ 按着时按 ⌃：是在组合，不是连按 ⌃
        let mut events = vec![
            (TapInput::Down(LALT), 0),
            (TapInput::Down(LCTRL), 20),
            (TapInput::Up(LCTRL), 60),
            (TapInput::Up(LALT), 80),
        ];
        events.extend(tap(LCTRL, 150));
        assert!(run(&events).is_empty());
    }

    #[test]
    fn left_then_right_is_not_a_double_tap() {
        let mut events = tap(LCTRL, 0).to_vec();
        events.extend(tap(RCTRL, 150));
        assert!(run(&events).is_empty());
    }
}
