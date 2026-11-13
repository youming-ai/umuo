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

/// 普通组合键（`Alt+D`）解析出来的修饰键与主键。主键是 W3C `KeyboardEvent.code` 名（`KeyD`、`ArrowUp`），
/// 换成平台键码（macOS 的 `kVK_*`）与「这个键注册不了」的判断留给平台层。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Combo {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub cmd: bool,
    pub code: String,
}

/// Swift `CharacterSet.whitespaces` 的范围：制表符与 Unicode Zs 类空白（不含换行）。
/// 组合键语法从 Swift 版本迁过来，修剪规则要逐字一致。
fn is_inline_space(c: char) -> bool {
    matches!(
        c,
        '\t' | ' ' | '\u{00A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}'
    )
}

/// 组合键语法：沿用 `global-hotkey` 0.8 的 `parse_hotkey`，是已发布版本 `settings.json` 与录键器的存储格式。
///
/// - 以 `+` 分隔，各段去掉首尾空白；修饰键别名不分大小写，macOS 上 `CommandOrControl` 就是 ⌘。
/// - 恰好一个主键，且主键之后不能再有任何段：`Ctrl+C+A`、`Ctrl+C+Shift` 不合法。
/// - 空段（`Ctrl++D`、`Ctrl+`）、只有修饰键（`Alt`）、认不出的键（`Alt+Foo`）不合法。
/// - 只有一段时**不修剪**（与 `global-hotkey` 相同；整条值在 [`parse_hotkey`] 已经整体修剪过）。
pub fn parse_combo(value: &str) -> Option<Combo> {
    let tokens: Vec<&str> = value.split('+').collect();
    if let [single] = tokens.as_slice() {
        return parse_key(single).map(|code| Combo {
            code,
            ..Combo::default()
        });
    }
    let mut combo = Combo::default();
    let mut key: Option<String> = None;
    for raw in tokens {
        let token = raw.trim_matches(is_inline_space);
        if token.is_empty() || key.is_some() {
            return None;
        }
        match token.to_uppercase().as_str() {
            "OPTION" | "ALT" => combo.alt = true,
            "CONTROL" | "CTRL" => combo.ctrl = true,
            "COMMAND" | "CMD" | "SUPER" => combo.cmd = true,
            "SHIFT" => combo.shift = true,
            "COMMANDORCONTROL" | "COMMANDORCTRL" | "CMDORCTRL" | "CMDORCONTROL" => combo.cmd = true,
            _ => key = Some(parse_key(token)?),
        }
    }
    combo.code = key?;
    Some(combo)
}

/// 主键别名 → W3C `code` 名（`global-hotkey` 的 `parse_key`）。认不出的返回 `None`。
pub fn parse_key(token: &str) -> Option<String> {
    let upper = token.to_uppercase();
    if let Some(code) = key_alias(&upper) {
        return Some(code.to_string());
    }
    let chars: Vec<char> = upper.chars().collect();
    let last = chars.last().copied();
    // KeyA…KeyZ / A…Z
    if let [c @ 'A'..='Z'] = chars.as_slice() {
        return Some(format!("Key{c}"));
    }
    if chars.len() == 4 && upper.starts_with("KEY") && matches!(last, Some('A'..='Z')) {
        return Some(format!("Key{}", last?));
    }
    // Digit0…9 / 0…9
    if let [c @ '0'..='9'] = chars.as_slice() {
        return Some(format!("Digit{c}"));
    }
    if chars.len() == 6 && upper.starts_with("DIGIT") && matches!(last, Some('0'..='9')) {
        return Some(format!("Digit{}", last?));
    }
    // Numpad0…9 / Num0…9
    for prefix in ["NUMPAD", "NUM"] {
        if chars.len() == prefix.len() + 1
            && upper.starts_with(prefix)
            && matches!(last, Some('0'..='9'))
        {
            return Some(format!("Numpad{}", last?));
        }
    }
    // F1…F24（不收 F01 这类前导零；与 Swift 的 `Int(_:)` 一样接受前导 `+`）
    if let Some(rest) = upper.strip_prefix('F') {
        if !rest.starts_with('0') {
            if let Ok(n @ 1..=24) = rest.parse::<i64>() {
                return Some(format!("F{n}"));
            }
        }
    }
    None
}

fn key_alias(upper: &str) -> Option<&'static str> {
    Some(match upper {
        "BACKQUOTE" | "`" => "Backquote",
        "BACKSLASH" | "\\" => "Backslash",
        "BRACKETLEFT" | "[" => "BracketLeft",
        "BRACKETRIGHT" | "]" => "BracketRight",
        "PAUSE" | "PAUSEBREAK" => "Pause",
        "COMMA" | "," => "Comma",
        "EQUAL" | "=" => "Equal",
        "MINUS" | "-" => "Minus",
        "PERIOD" | "." => "Period",
        "QUOTE" | "'" => "Quote",
        "SEMICOLON" | ";" => "Semicolon",
        "SLASH" | "/" => "Slash",
        "BACKSPACE" => "Backspace",
        "CAPSLOCK" => "CapsLock",
        "ENTER" => "Enter",
        "SPACE" => "Space",
        "TAB" => "Tab",
        "DELETE" => "Delete",
        "END" => "End",
        "HOME" => "Home",
        "INSERT" => "Insert",
        "PAGEDOWN" => "PageDown",
        "PAGEUP" => "PageUp",
        "PRINTSCREEN" => "PrintScreen",
        "SCROLLLOCK" => "ScrollLock",
        "ARROWDOWN" | "DOWN" => "ArrowDown",
        "ARROWLEFT" | "LEFT" => "ArrowLeft",
        "ARROWRIGHT" | "RIGHT" => "ArrowRight",
        "ARROWUP" | "UP" => "ArrowUp",
        "NUMLOCK" => "NumLock",
        "NUMPADADD" | "NUMADD" | "NUMPADPLUS" | "NUMPLUS" => "NumpadAdd",
        "NUMPADDECIMAL" | "NUMDECIMAL" => "NumpadDecimal",
        "NUMPADDIVIDE" | "NUMDIVIDE" => "NumpadDivide",
        "NUMPADENTER" | "NUMENTER" => "NumpadEnter",
        "NUMPADEQUAL" | "NUMEQUAL" => "NumpadEqual",
        "NUMPADMULTIPLY" | "NUMMULTIPLY" => "NumpadMultiply",
        "NUMPADSUBTRACT" | "NUMSUBTRACT" => "NumpadSubtract",
        "ESCAPE" | "ESC" => "Escape",
        "AUDIOVOLUMEDOWN" | "VOLUMEDOWN" => "AudioVolumeDown",
        "AUDIOVOLUMEUP" | "VOLUMEUP" => "AudioVolumeUp",
        "AUDIOVOLUMEMUTE" | "VOLUMEMUTE" => "AudioVolumeMute",
        "MEDIAPLAY" => "MediaPlay",
        "MEDIAPAUSE" => "MediaPause",
        "MEDIAPLAYPAUSE" => "MediaPlayPause",
        "MEDIASTOP" => "MediaStop",
        "MEDIATRACKNEXT" => "MediaTrackNext",
        "MEDIATRACKPREV" | "MEDIATRACKPREVIOUS" => "MediaTrackPrevious",
        _ => return None,
    })
}

/// 冲突检查用的规范写法：解析得了就是 `ctrl+alt+shift+cmd+<code>`（修饰键固定顺序、全小写），
/// 写法不同但注册出来是同一个键的值（`Option+D` / `alt+KeyD`）得到同一个结果。
/// 解析不了的值注册时会回落到默认键位，这里只去掉首尾空白并小写，不再猜它「本来想写什么」。
pub fn normalize_combo(value: &str) -> String {
    let Some(combo) = parse_combo(value.trim_matches(is_inline_space)) else {
        return value.trim_matches(is_inline_space).to_lowercase();
    };
    let mut parts: Vec<String> = [
        (combo.ctrl, "ctrl"),
        (combo.alt, "alt"),
        (combo.shift, "shift"),
        (combo.cmd, "cmd"),
    ]
    .into_iter()
    .filter(|(on, _)| *on)
    .map(|(_, name)| name.to_string())
    .collect();
    parts.push(combo.code.to_lowercase());
    parts.join("+")
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

    fn combo(ctrl: bool, alt: bool, shift: bool, cmd: bool, code: &str) -> Option<Combo> {
        Some(Combo {
            ctrl,
            alt,
            shift,
            cmd,
            code: code.into(),
        })
    }

    /// 与 Swift `HotkeySelfTest.combos` 的表一致（迁移前那份 Swift 解析器的行为）。
    #[test]
    fn combos_follow_the_global_hotkey_syntax() {
        let cases = [
            ("Alt+D", combo(false, true, false, false, "KeyD")),
            ("alt + cmd + a", combo(false, true, false, true, "KeyA")),
            (
                "CommandOrControl+Shift+KeyT",
                combo(false, false, true, true, "KeyT"),
            ),
            (
                "Control+Option+Digit1",
                combo(true, true, false, false, "Digit1"),
            ),
            ("Super+Esc", combo(false, false, false, true, "Escape")),
            ("F5", combo(false, false, false, false, "F5")),
            ("Alt+F24", combo(false, true, false, false, "F24")),
            ("Alt+Pause", combo(false, true, false, false, "Pause")),
            ("Ctrl+Num5", combo(true, false, false, false, "Numpad5")),
            ("Ctrl+NumPad0", combo(true, false, false, false, "Numpad0")),
            ("Ctrl+Up", combo(true, false, false, false, "ArrowUp")),
            ("Ctrl+`", combo(true, false, false, false, "Backquote")),
            ("Cmd+-", combo(false, false, false, true, "Minus")),
            ("Ctrl+\u{3000}D\t", combo(true, false, false, false, "KeyD")),
        ];
        for (value, expected) in cases {
            assert_eq!(parse_combo(value), expected, "{value}");
        }
        for value in [
            "Ctrl+",
            "Ctrl++D",
            "Ctrl+C+A",
            "Ctrl+C+Shift",
            "Alt",
            "Alt+Foo",
            "",
            "Alt+F0",
            "Alt+F01",
            "Alt+F25",
            "Alt+KeyAB",
            "Meta+D",
            "Opt+D",
            "D+Alt",
        ] {
            assert_eq!(parse_combo(value), None, "{value:?} 应该解析不了");
        }
        // 只有一段时不修剪（与 global-hotkey 相同），整条值在 parse_hotkey 已整体修剪过
        assert_eq!(parse_combo(" D"), None);
        // 修剪不含换行（Swift 的 whitespaces 不含换行）
        assert_eq!(parse_combo("Ctrl+D\n"), None);
    }

    #[test]
    fn function_keys_accept_a_leading_plus_but_not_zero_padding() {
        assert_eq!(parse_key("f12").as_deref(), Some("F12"));
        assert_eq!(parse_key("F+5").as_deref(), Some("F5"));
        assert_eq!(parse_key("F05"), None);
        assert_eq!(
            parse_key("F").as_deref(),
            Some("KeyF"),
            "单个字母 F 是字母键"
        );
        assert_eq!(parse_key("F-1"), None);
    }

    #[test]
    fn normalized_combos_ignore_aliases_order_and_spacing() {
        assert_eq!(normalize_combo("Option+D"), "alt+keyd");
        assert_eq!(normalize_combo("alt+d"), "alt+keyd");
        assert_eq!(normalize_combo("Command+Shift+T"), "shift+cmd+keyt");
        assert_eq!(normalize_combo("Shift+Cmd+T"), "shift+cmd+keyt");
        assert_eq!(normalize_combo("  Option + D  "), "alt+keyd");
        assert_eq!(normalize_combo("Ctrl+Up"), normalize_combo("Ctrl+ArrowUp"));
        assert_eq!(normalize_combo("cmd+option+esc"), "alt+cmd+escape");
        assert_eq!(normalize_combo(""), "");
        assert_eq!(normalize_combo("   "), "");
        // 注册不了的值不猜：原样小写，不会被当成别的键的重复
        assert_eq!(normalize_combo(" Meta+D "), "meta+d");
        assert_ne!(normalize_combo("Meta+D"), normalize_combo("Cmd+D"));
    }

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
