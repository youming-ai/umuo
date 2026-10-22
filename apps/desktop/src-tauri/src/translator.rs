//! 划词翻译的触发与窗口：取词 → 定位浮窗 → 交给 `umuo-app` 的翻译流水线。
//!
//! 流水线本身（规划、故障转移、离线回落、分片、记账、写回守卫、事件）在
//! `umuo_app::translate`，这里只剩宿主自己的事：快捷键入口、取词线程、浮窗的显示与归属，
//! 以及不经流水线的提示与「替换原文」。

use std::sync::Arc;

use tauri::{AppHandle, Manager};
use umuo_core::error::{CoreError, SuggestedAction};
use umuo_core::lang;
use umuo_platform::{FocusSource, FocusText, PlatformError, SelectionReader, Speech};

use crate::sink::TauriSink;
use crate::{AppState, PANEL_LABEL};

use umuo_app::event::{ErrorPayload, Route, TranslateEvent, TranslateSink};
// 请求、模式与覆盖随流水线搬进了 `umuo-app`；重新导出后命令层的 `translator::Request` 等路径不用改。
pub use umuo_app::translate::{retranslate_mode, Mode, Overrides, Request};

/// 发一个 translate:// 事件。事件名由事件本身决定（[`TranslateEvent::name`]）。
fn emit(app: &AppHandle, route: Route, event: impl Into<TranslateEvent>) {
    TauriSink(app.clone()).send(route, event.into());
}

/// 快捷键 / 托盘菜单触发的入口：划词翻译。
pub fn trigger(app: &AppHandle) {
    trigger_inner(app, Mode::Selection);
}

/// 快捷键 / 托盘菜单触发的入口：输入框原地替换（静默翻译）。
pub fn trigger_silent_replace(app: &AppHandle) {
    trigger_inner(app, Mode::SilentReplace);
}

/// 取词在**独立线程**上做：降级路径要等最多 400ms 的剪贴板轮询，
/// 放在主线程会让浮窗「先卡一下再出现」，PRD §8 的 150ms 唤醒指标立刻不达标。
///
/// 只有划词与静默翻译两个入口走这里；撰写窗的文本是用户打进去的，不取词。
fn trigger_inner(app: &AppHandle, mode: Mode) {
    // PRD §8 的「唤起速度 ≤ 150ms」从这里开始计时：这是按键事件到达我们手里的时刻。
    // 分段而不是只报一个总数——取词（AX / 剪贴板降级）才是主要成本，
    // 只报总数的话，超了也不知道该怪谁。
    let wake_started = std::time::Instant::now();
    debug_assert!(
        matches!(mode, Mode::Selection | Mode::SilentReplace),
        "撰写窗不取词，不该走到 trigger_inner"
    );
    let silent = mode == Mode::SilentReplace;

    let app = app.clone();
    std::thread::spawn(move || {
        // 按下快捷键就顶掉浮窗上一次的请求：哪怕这次取词失败，旧译文也不该继续流进来。
        let ticket = app.state::<AppState>().requests.begin(PANEL_LABEL);
        let route = Route {
            surface: PANEL_LABEL,
            request_id: ticket.id,
            back: false,
        };
        // 作用域刻意收窄：State 借用了 app，而下面要把 app 移动进异步任务。
        let (read, target) = {
            let state = app.state::<AppState>();
            let settings = state.settings.lock().expect("设置锁不应中毒").clone();

            // PRD §7.3 的取词黑名单：密码管理器等应用**在读取之前**就拦下。
            // 判定需要前台应用名（一次 AX 往返），所以黑名单为空时跳过这一步，
            // 不给默认路径增加成本。拦下要用浮窗说清楚，而不是无声无息。
            if !settings.selection_blacklist.is_empty() {
                if let Some(app_name) = state.selection.frontmost_app_name().as_deref() {
                    if settings.is_selection_blocked(app_name) {
                        show_panel_near_cursor(&app);
                        emit(
                            &app,
                            route,
                            ErrorPayload {
                                message: format!(
                                    "「{app_name}」在取词黑名单里，没有读取选中的内容。可在设置里调整。"
                                ),
                                actions: vec![SuggestedAction::OpenModelSettings],
                                needs_permission: false,
                                permission: None,
                                source: None,
                            },
                        );
                        return;
                    }
                }
            }

            // 写回前要确认目标应用没被换掉，所以先记下它的标识。
            let target = if silent {
                state.selection.frontmost_app_token()
            } else {
                None
            };
            let read = if silent {
                // 静默翻译用 read_focus_text：没有选区时读整个输入框，
                // 且不做剪贴板降级（写回依赖同一条通道，降级取词救不回来）。
                // 来源（选区 / 整框）要一路带到写回，见 `Request::focus_source`。
                state.selection.read_focus_text()
            } else {
                state.selection.read_selection().map(|text| FocusText {
                    text,
                    source: FocusSource::Selection,
                })
            };
            (read, target)
        };

        let read_ms = wake_started.elapsed().as_millis();
        let focus = match read {
            Ok(focus) => focus,
            Err(error) => {
                eprintln!("umuo: 取词耗时 {read_ms}ms（失败）");
                show_panel_near_cursor_traced(&app, Some(wake_started));
                emit_platform_error(&app, ticket.id, &error);
                return;
            }
        };

        eprintln!("umuo: 取词耗时 {read_ms}ms");
        show_panel_near_cursor_traced(&app, Some(wake_started));
        tauri::async_runtime::spawn(async move {
            let request = if silent {
                Request::silent_replace(focus.text, crate::host_mac::app_focus_source(focus.source))
            } else {
                Request::selection(focus.text)
            };
            let core = crate::core(&app);
            umuo_app::translate::run(&core, &TauriSink(app.clone()), request, target, ticket).await;
        });
    });
}

/// ⌥R：朗读当前选中的文本（PRD §7.2）。
///
/// 与翻译不同，它**不弹浮窗**——用户要的是把这段读出来，不是看译文。
/// 取不到选区时才用浮窗说话：一个"按了没反应"的全局快捷键比报错更让人困惑。
///
/// 再按一次不会停：`speak` 的契约是「先停上一段再开始新的」，
/// 连按两次的结果是重新读一遍，比叠音或没反应都好。
pub fn trigger_speak(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        // 朗读同样受黑名单约束：把密码读出声，比翻译它更糟。
        // 拦下不是权限问题，别把用户引去辅助功能设置。
        if let Some(app_name) = state.selection.frontmost_app_name() {
            let settings = state.settings.lock().expect("设置锁不应中毒").clone();
            if settings.is_selection_blocked(&app_name) {
                emit_notice(
                    &app,
                    &format!("「{app_name}」在取词黑名单里，没有读取选中的内容。可在设置里调整。"),
                    None,
                );
                return;
            }
        }
        // 出错一律走 emit_notice：它会把浮窗弹出来。朗读本身不弹浮窗，
        // 只发事件的话错误落在一个看不见的窗口里，等于「按了没反应」。
        let report = |error: &PlatformError| {
            emit_notice(
                &app,
                &error.to_string(),
                error.is_permission_problem().then_some("accessibility"),
            )
        };
        match state.selection.read_selection() {
            Ok(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    return;
                }
                let language = lang::detect(trimmed);
                if let Err(error) = state.speech.speak(trimmed, language) {
                    report(&error);
                }
            }
            Err(error) => report(&error),
        }
    });
}

/// 从别处传入文本时用这个：浮窗的「重译」按钮，以及撰写窗的翻译命令。
///
/// `guard` 只有静默翻译才需要——它是写回前的目标校验凭据。
///
/// 登记在调用时**同步**完成：新请求立刻顶掉同一窗口的旧请求，不必等异步任务排上队。
pub fn spawn(app: &AppHandle, request: Request, guard: Option<String>) {
    let run = crate::core(app).start_translation(request, guard, Arc::new(TauriSink(app.clone())));
    tauri::async_runtime::spawn(run);
}

/// 从浮窗传入文本时用这个。
pub fn trigger_with_text(app: &AppHandle, text: String) {
    // 手动重译永远走「只显示」：用户点的是浮窗里的按钮，
    // 没有理由让第二次尝试突然去改写他的原文。
    spawn(app, Request::selection(text), None);
}

/// 浮窗「替换原文」：把译文写回源应用的选区（PRD §5.2）。
///
/// 守卫与静默翻译的写回是同一条判据（[`umuo_app::translate::target_still_matches`]）：
/// 先确认前台应用没换，再写。
pub(crate) fn write_back(
    app: &AppHandle,
    target: Option<&str>,
    text: &str,
) -> Result<(), CoreError> {
    let state = app.state::<AppState>();
    // 翻译花了几秒，用户完全可能已经切到别的窗口。这时写回等于把译文打进
    // 另一个应用——宁可不替换，也不能写错地方。
    if !umuo_app::translate::target_still_matches(target, state.selection.frontmost_app_token()) {
        return Err(CoreError::WriteTargetChanged);
    }

    state
        .selection
        .replace_selection(text)
        .map_err(|error| CoreError::WriteBackFailed {
            detail: error.to_string(),
        })
}

/// `request_id` 是这次取词所属的请求：取词失败也是「这一次」的结果，
/// 前端靠它把上一次的原文与译文清掉（审查 M15）。
fn emit_platform_error(app: &AppHandle, request_id: u64, error: &PlatformError) {
    emit(
        app,
        Route {
            surface: PANEL_LABEL,
            request_id,
            back: false,
        },
        ErrorPayload {
            message: error.to_string(),
            actions: Vec::new(),
            needs_permission: error.is_permission_problem(),
            // 走到这里的一律是取词路径（截图那条另有自己的提示）。
            permission: error.is_permission_problem().then_some("accessibility"),
            source: None,
        },
    );
}

/// 让浮窗显示一条**不来自翻译引擎**的提示（截图失败、识别不到文字、缺权限…）。
///
/// 复用同一个事件与同一个浮窗：用户按了快捷键就该在同一个地方看到结果，
/// 而不是「有的功能弹浮窗、有的功能什么都不显示」。
///
/// 提示本身就是一次新的结果：登记一个新请求，顶掉浮窗上还在流的旧翻译。
pub fn emit_notice(app: &AppHandle, message: &str, permission: Option<&'static str>) {
    let request_id = app.state::<AppState>().requests.begin(PANEL_LABEL).id;
    emit(
        app,
        Route {
            surface: PANEL_LABEL,
            request_id,
            back: false,
        },
        ErrorPayload {
            message: message.to_string(),
            actions: Vec::new(),
            needs_permission: permission.is_some(),
            permission,
            source: None,
        },
    );
    show_panel_near_cursor(app);
}

/// 是否应当因为「用户切到了别的应用」而收起浮窗（PRD §7.1：失焦关闭，可钉住）。
///
/// 为什么不用窗口的失焦事件：浮窗是**非激活**窗口，它在创建时就不接受焦点
/// （`focused(false)`），因此没有可靠的 blur 事件可听。而「用户切走了」
/// 才是他真正想收起浮窗的信号——所以用前台应用标识判定。
///
/// 拿不到标识时**不收起**：宁可让浮窗多留一会儿，也不能让用户正在读的东西凭空消失。
///
/// `own` 是本应用自己的标识（[`own_app_token`]）。前台是自己 = 用户在点浮窗
/// （浮窗不是真·非激活 NSPanel，一点就激活本应用），不算切走（审查 H5）。
/// 浮窗归属于自己（快捷面板里输入的文字，没有源应用）时也不按切走收起——
/// 否则面板一收起、焦点回到别的应用，浮窗就跟着消失了。
pub fn should_auto_hide(
    pinned: bool,
    owner: Option<&str>,
    current: Option<String>,
    own: &str,
) -> bool {
    if pinned {
        return false;
    }
    match (owner, current.as_deref()) {
        (Some(owner), Some(current)) => owner != own && current != own && owner != current,
        _ => false,
    }
}

/// 本应用自己的前台标识，与 `frontmost_app_token` 同一口径（macOS 上是 pid）。
pub fn own_app_token() -> String {
    std::process::id().to_string()
}

/// 浮窗「替换原文」写回前该怎么做（审查 H5）。
#[derive(Debug, PartialEq, Eq)]
pub enum ReplacePlan {
    /// 浮窗没有源应用（快捷面板输入）：没有原文可替换。
    NoSource,
    /// 前台是本应用（用户刚点了浮窗）：先把源应用切回前台，等焦点回来再写。
    Refocus,
    /// 直接交给写回守卫：前台仍是源应用就写，换了就拒绝。
    Write,
}

pub fn plan_replace(owner: Option<&str>, current: Option<&str>, own: &str) -> ReplacePlan {
    match owner {
        Some(owner) if owner == own => ReplacePlan::NoSource,
        Some(_) if current == Some(own) => ReplacePlan::Refocus,
        _ => ReplacePlan::Write,
    }
}

/// 截图翻译、快捷面板输入这类**不经划词**的入口：浮窗没开就先开出来（审查 H3）。
///
/// 划词路径自己会显示浮窗；这两条以前只往浮窗发事件，成功时浮窗一直藏着，
/// 只有失败的提示会把它弹出来。已经开着就不挪位置，免得把用户正在看的浮窗拽到鼠标下。
///
/// **无论浮窗开没开，都把归属重设为本应用自己。** 这两条入口的原文不是从任何应用里
/// 选出来的（截图来自像素，快捷面板是用户现打的），没有可替换的原文：
/// - 不能沿用上一次划词的归属——浮窗还开着时，「替换原文」会切回那个应用、把 OCR 译文写进去；
/// - 也不能取当前前台应用——截图结束、快捷面板收起后前台是用户原来的应用，同样会被写进去。
///
/// 归属是自己时 [`plan_replace`] 返回 `NoSource`，看门狗也不会因切走而收起浮窗。
/// 先写归属再显示：看门狗看到浮窗可见时，归属已经是新的。
pub fn ensure_panel_shown(app: &AppHandle) {
    {
        let state = app.state::<AppState>();
        *state.panel_owner.lock().expect("浮窗归属锁不应中毒") = Some(no_source_owner());
    }
    let Some(panel) = app.get_webview_window(PANEL_LABEL) else {
        return;
    };
    if panel.is_visible().unwrap_or(false) {
        return;
    }
    if let Ok(cursor) = app.cursor_position() {
        let _ = panel.set_position(tauri::PhysicalPosition::new(
            cursor.x + 14.0,
            cursor.y + 18.0,
        ));
    }
    let _ = panel.show();
}

/// 不经划词的入口给浮窗记的归属：本应用自己，表示「没有源应用」。
pub fn no_source_owner() -> String {
    own_app_token()
}

/// 把浮窗放到鼠标附近。
///
/// 精确地贴在选区旁边需要 `AXBoundsForRange`（目前没做），所以先用鼠标位置——
/// 用户按快捷键时光标就在选区附近，误差在可接受范围内。
/// 「精确锚定到选区」列为后续项。
fn show_panel_near_cursor(app: &AppHandle) {
    show_panel_near_cursor_traced(app, None)
}

/// 同 [`show_panel_near_cursor`]，但可以带一个计时起点（PRD §8 实测用）。
///
/// 把实测与业务分开写成两个函数，是为了让业务路径不被迫接受一个
/// 只有测量才需要的参数——埋点可以删，业务不能因为埋点而变丑。
fn show_panel_near_cursor_traced(app: &AppHandle, wake_started: Option<std::time::Instant>) {
    let Some(panel) = app.get_webview_window(PANEL_LABEL) else {
        return;
    };
    if let Ok(cursor) = app.cursor_position() {
        let _ = panel.set_position(tauri::PhysicalPosition::new(
            cursor.x + 14.0,
            cursor.y + 18.0,
        ));
    }
    let _ = panel.show();

    // 记下「这次翻译属于哪个应用」：看门狗据此判断用户是不是切走了。
    //
    // **放在 show() 之后**：这也是一次 AX 往返（实测十几毫秒），而它只服务于
    // 500ms 一轮的看门狗——排在显示前面就是白白拖慢 PRD §8 的唤起速度。
    {
        let state = app.state::<AppState>();
        *state.panel_owner.lock().expect("浮窗归属锁不应中毒") =
            state.selection.frontmost_app_token();
    }

    if let Some(started) = wake_started {
        // 一行一个数，方便直接 grep 出来做统计。PRD §8 的门槛是 150ms。
        eprintln!(
            "umuo: 唤起耗时 {}ms（按键→浮窗出现，不含取词以外的模型响应）",
            started.elapsed().as_millis()
        );
    }
}

#[cfg(test)]
mod panel_auto_hide_tests {
    use super::*;

    const OWN: &str = "umuo";

    #[test]
    fn switching_to_another_app_hides_the_panel() {
        assert!(should_auto_hide(
            false,
            Some("app-A"),
            Some("app-B".to_string()),
            OWN
        ));
    }

    #[test]
    fn staying_in_the_same_app_keeps_it_open() {
        assert!(!should_auto_hide(
            false,
            Some("app-A"),
            Some("app-A".to_string()),
            OWN
        ));
    }

    #[test]
    fn a_pinned_panel_never_auto_hides() {
        // 「可钉住」的全部含义就在这一条。
        assert!(!should_auto_hide(
            true,
            Some("app-A"),
            Some("app-B".to_string()),
            OWN
        ));
    }

    #[test]
    fn an_unreadable_token_never_hides_the_panel() {
        // 读不到前台应用时宁可多留一会儿，也不能让用户正在读的浮窗凭空消失。
        assert!(!should_auto_hide(false, Some("app-A"), None, OWN));
        assert!(!should_auto_hide(
            false,
            None,
            Some("app-B".to_string()),
            OWN
        ));
        assert!(!should_auto_hide(false, None, None, OWN));
    }

    #[test]
    fn clicking_the_panel_itself_is_not_switching_away() {
        // 审查 H5：点浮窗会激活本应用，前台变成自己——这不是「切走」。
        assert!(!should_auto_hide(
            false,
            Some("app-A"),
            Some(OWN.to_string()),
            OWN
        ));
    }

    #[test]
    fn a_panel_owned_by_umuo_itself_is_not_hidden_by_focus_changes() {
        // 快捷面板输入：浮窗显示时前台是自己，面板收起后焦点回到别的应用也不该收起。
        assert!(!should_auto_hide(
            false,
            Some(OWN),
            Some("app-B".to_string()),
            OWN
        ));
    }
}

#[cfg(test)]
mod replace_plan_tests {
    use super::*;

    const OWN: &str = "umuo";

    #[test]
    fn clicking_replace_refocuses_the_source_app_first() {
        // 审查 H5：点「替换原文」时前台必然是自己，直接写守卫必然拒绝。
        assert_eq!(
            plan_replace(Some("app-A"), Some(OWN), OWN),
            ReplacePlan::Refocus
        );
    }

    #[test]
    fn a_panel_without_a_source_app_has_nothing_to_replace() {
        // 不能写回本应用自己：那会把译文打进快捷面板或浮窗。
        assert_eq!(
            plan_replace(Some(OWN), Some(OWN), OWN),
            ReplacePlan::NoSource
        );
    }

    #[test]
    fn entries_without_a_selection_never_write_back_or_auto_hide() {
        // 审查意见：截图 OCR / 快捷面板的结果不能写进上一次划词的应用、也不能写进
        // 截图结束后的前台应用。它们的归属是本应用自己，无论前台是谁都没有原文可替换。
        let owner = no_source_owner();
        let own = own_app_token();
        for current in [own.as_str(), "app-A", "app-B"] {
            assert_eq!(
                plan_replace(Some(&owner), Some(current), &own),
                ReplacePlan::NoSource
            );
            assert!(!should_auto_hide(
                false,
                Some(&owner),
                Some(current.to_string()),
                &own
            ));
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
        assert_eq!(plan_replace(None, Some(OWN), OWN), ReplacePlan::Write);
    }
}
