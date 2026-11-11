//! 浮窗的纯规则：切走就收起（看门狗）、「替换原文」写回前该怎么做、取词黑名单的提示。
//!
//! SwiftUI 客户端经 `umuo-ffi` 调用这份规则，避免在视图层重复实现。
//!
//! 标识（token）一律是前台应用的 pid 十进制字符串（Swift 端 `FrontmostApp.liveToken`）；
//! `own` 是本应用自己的 pid。**不要**传 `Host::frontmost_app_token`：那是静默翻译用的控件身份，口径不同，
//! 混用会让每次比较都不相等。浮窗归属是 `own` 表示「没有源应用」（截图 OCR）。

use umuo_core::error::CoreError;

use crate::settings::Settings;
use crate::translate::target_still_matches;

/// 是否应当因为「用户切到了别的应用」而收起浮窗（PRD §7.1：失焦关闭，可钉住）。
///
/// 为什么不用窗口的失焦事件：浮窗是**非激活**窗口，不接受焦点，没有可靠的 blur 事件可听。
/// 而「用户切走了」才是他真正想收起浮窗的信号——所以用前台应用标识判定。
///
/// 拿不到标识时**不收起**：宁可让浮窗多留一会儿，也不能让用户正在读的东西凭空消失。
///
/// 前台是自己（用户在用本应用的撰写窗、设置窗）不算切走（审查 H5）。
/// 浮窗归属于自己（没有源应用）时也不按切走收起——否则截图框选一结束、焦点回到别的应用，
/// 浮窗就跟着消失了。
pub fn should_auto_hide(
    pinned: bool,
    owner: Option<&str>,
    current: Option<&str>,
    own: &str,
) -> bool {
    if pinned {
        return false;
    }
    match (owner, current) {
        (Some(owner), Some(current)) => owner != own && current != own && owner != current,
        _ => false,
    }
}

/// 浮窗「替换原文」写回前该怎么做（审查 H5）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplacePlan {
    /// 浮窗没有源应用（截图 OCR）：没有原文可替换。
    NoSource,
    /// 不知道原文来自哪个应用（取前台标识失败：应用无响应、安全输入等）：拒绝写回。
    ///
    /// 与静默翻译的「之前就拿不到就放行」不同：静默翻译在按键的那一刻读取并写回同一个输入框，
    /// 而浮窗的替换是用户过了一会儿才点的——此时前台是谁完全不确定，放行就可能写进别的应用。
    UnknownSource,
    /// 前台是本应用：先把源应用切回前台，等焦点回来再写。
    Refocus,
    /// 直接交给写回守卫（[`crate::translate::target_still_matches`]）：前台仍是源应用就写，换了就拒绝。
    Write,
}

/// 「没有可替换的原文」的提示（`ReplacePlan::NoSource`），两个客户端同一句。
pub const NO_SOURCE_MESSAGE: &str = "这段文字不是从别的应用里取的，没有可替换的原文";

pub fn plan_replace(owner: Option<&str>, current: Option<&str>, own: &str) -> ReplacePlan {
    match owner {
        None => ReplacePlan::UnknownSource,
        Some(owner) if owner == own => ReplacePlan::NoSource,
        Some(_) if current == Some(own) => ReplacePlan::Refocus,
        _ => ReplacePlan::Write,
    }
}

/// 「替换原文」写回前的最后一道守卫：与静默翻译同一条判据（[`target_still_matches`]）。
/// 前台已经换掉时返回给用户看的拒绝理由，放行时为 `None`。
///
/// 翻译花了几秒，用户完全可能已经切到别的窗口。这时写回等于把译文打进另一个应用——
/// 宁可不替换，也不能写错地方。`owner` 是显示浮窗时记下的源应用，`current` 是现查的前台。
///
/// 不知道源应用（`owner` 为空）时同样拒绝：静默翻译那条「之前就拿不到就放行」只适用于按键当场写回，
/// 浮窗的替换隔了一段时间，没有可比对的标识就无从确认写到哪里（见 [`ReplacePlan::UnknownSource`]）。
pub fn replace_target_error(owner: Option<&str>, current: Option<String>) -> Option<String> {
    let matches = owner.is_some() && target_still_matches(owner, current);
    (!matches).then(|| CoreError::WriteTargetChanged.to_string())
}

/// 写入本身失败（AX 与 ⌘V 都没写进去）时给用户看的话，与静默翻译的 `WriteBackFailed` 同一句式。
pub fn write_back_failed_message(detail: &str) -> String {
    CoreError::WriteBackFailed {
        detail: detail.to_owned(),
    }
    .to_string()
}

/// 取词黑名单（PRD §7.3）拦下时给用户看的话；没拦下为 `None`。
///
/// 划词翻译、原地替换、朗读在**读取之前**问它：密码管理器里的内容不该被读出来，更不该念出声。
/// 黑名单为空时直接放行，不给默认路径增加成本。
pub fn selection_block_notice(settings: &Settings, app_name: &str) -> Option<String> {
    if settings.selection_blacklist.is_empty() || !settings.is_selection_blocked(app_name) {
        return None;
    }
    Some(format!(
        "「{app_name}」在取词黑名单里，没有读取选中的内容。可在设置里调整。"
    ))
}

#[cfg(test)]
mod auto_hide_tests {
    use super::*;

    const OWN: &str = "umuo";

    #[test]
    fn switching_to_another_app_hides_the_panel() {
        assert!(should_auto_hide(false, Some("app-A"), Some("app-B"), OWN));
    }

    #[test]
    fn staying_in_the_same_app_keeps_it_open() {
        assert!(!should_auto_hide(false, Some("app-A"), Some("app-A"), OWN));
    }

    #[test]
    fn a_pinned_panel_never_auto_hides() {
        // 「可钉住」的全部含义就在这一条。
        assert!(!should_auto_hide(true, Some("app-A"), Some("app-B"), OWN));
    }

    #[test]
    fn an_unreadable_token_never_hides_the_panel() {
        // 读不到前台应用时宁可多留一会儿，也不能让用户正在读的浮窗凭空消失。
        assert!(!should_auto_hide(false, Some("app-A"), None, OWN));
        assert!(!should_auto_hide(false, None, Some("app-B"), OWN));
        assert!(!should_auto_hide(false, None, None, OWN));
    }

    #[test]
    fn our_own_app_in_front_is_not_switching_away() {
        // 审查 H5：前台变成自己（点浮窗、开撰写窗）——这不是「切走」。
        assert!(!should_auto_hide(false, Some("app-A"), Some(OWN), OWN));
    }

    #[test]
    fn a_panel_owned_by_umuo_itself_is_not_hidden_by_focus_changes() {
        // 截图 OCR：浮窗显示时前台是自己，框选结束后焦点回到别的应用也不该收起。
        assert!(!should_auto_hide(false, Some(OWN), Some("app-B"), OWN));
    }
}

#[cfg(test)]
mod replace_plan_tests {
    use super::*;

    const OWN: &str = "umuo";

    #[test]
    fn clicking_replace_while_umuo_is_in_front_refocuses_the_source_app_first() {
        assert_eq!(
            plan_replace(Some("app-A"), Some(OWN), OWN),
            ReplacePlan::Refocus
        );
    }

    #[test]
    fn a_panel_without_a_source_app_has_nothing_to_replace() {
        // 不能写回本应用自己：那会把译文打进本应用的窗口。
        assert_eq!(
            plan_replace(Some(OWN), Some(OWN), OWN),
            ReplacePlan::NoSource
        );
    }

    #[test]
    fn entries_without_a_selection_never_write_back_or_auto_hide() {
        // 截图 OCR 的结果不能写进上一次划词的应用、也不能写进截图结束后的前台应用。
        for current in [OWN, "app-A", "app-B"] {
            assert_eq!(
                plan_replace(Some(OWN), Some(current), OWN),
                ReplacePlan::NoSource
            );
            assert!(!should_auto_hide(false, Some(OWN), Some(current), OWN));
        }
    }

    #[test]
    fn otherwise_the_write_guard_decides() {
        assert_eq!(
            plan_replace(Some("app-A"), Some("app-A"), OWN),
            ReplacePlan::Write
        );
        // 用户已经切到第三个应用：不替他切回去，交给守卫拒绝。
        assert_eq!(
            plan_replace(Some("app-A"), Some("app-B"), OWN),
            ReplacePlan::Write
        );
    }

    #[test]
    fn an_unknown_source_app_never_writes_back() {
        // 取不到源应用（无响应、安全输入）时，点「替换原文」不能把译文写进此刻的前台应用。
        for current in [None, Some(OWN), Some("app-A")] {
            assert_eq!(plan_replace(None, current, OWN), ReplacePlan::UnknownSource);
        }
    }
}

#[cfg(test)]
mod replace_guard_tests {
    use super::*;

    #[test]
    fn the_guard_refuses_once_the_front_app_changed() {
        assert_eq!(replace_target_error(Some("42"), Some("42".into())), None);
        let changed = replace_target_error(Some("42"), Some("7".into())).expect("换了应用要拒绝");
        assert_eq!(changed, "目标应用已切换，已放弃替换原文");
        // 之前拿得到、现在拿不到：按已切换处理。
        assert!(replace_target_error(Some("42"), None).is_some());
        // 之前就拿不到：浮窗替换不放行（与静默翻译的取舍不同，见 `ReplacePlan::UnknownSource`）。
        assert!(replace_target_error(None, None).is_some());
        assert!(replace_target_error(None, Some("42".into())).is_some());
    }

    #[test]
    fn write_failures_say_what_went_wrong() {
        assert_eq!(
            write_back_failed_message("应用拒绝了写入"),
            "写回原文失败：应用拒绝了写入"
        );
    }
}

#[cfg(test)]
mod blacklist_tests {
    use super::*;

    #[test]
    fn blocked_apps_get_a_notice_naming_the_app() {
        let settings = Settings::default();
        let notice =
            selection_block_notice(&settings, "1Password").expect("默认黑名单里有 1Password");
        assert_eq!(
            notice,
            "「1Password」在取词黑名单里，没有读取选中的内容。可在设置里调整。"
        );
        assert_eq!(selection_block_notice(&settings, "Safari"), None);
    }

    #[test]
    fn an_empty_blacklist_lets_everything_through() {
        let settings = Settings {
            selection_blacklist: Vec::new(),
            ..Settings::default()
        };
        assert_eq!(selection_block_notice(&settings, "1Password"), None);
    }
}
