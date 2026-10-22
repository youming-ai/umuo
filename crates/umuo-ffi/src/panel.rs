//! 浮窗的纯规则导出（`umuo_app::panel`）：看门狗的 `should_auto_hide`、「替换原文」的 `plan_replace`
//! 与写回守卫、取词黑名单的提示。只做换型，规则与测试在 `umuo-app`。

use umuo_app::panel as rules;

use crate::engine::Engine;

/// 「替换原文」写回前该怎么做，见 `umuo_app::panel::ReplacePlan`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ReplacePlan {
    /// 没有源应用（截图 OCR、快捷面板输入）：没有原文可替换。
    NoSource,
    /// 前台是本应用：先把源应用切回前台再写。
    Refocus,
    /// 直接交给写回守卫。
    Write,
}

impl From<rules::ReplacePlan> for ReplacePlan {
    fn from(plan: rules::ReplacePlan) -> Self {
        match plan {
            rules::ReplacePlan::NoSource => Self::NoSource,
            rules::ReplacePlan::Refocus => Self::Refocus,
            rules::ReplacePlan::Write => Self::Write,
        }
    }
}

/// 看门狗：用户是不是切到了别的应用、浮窗该不该收起。`own` 是本进程的 pid。
#[uniffi::export]
pub fn should_auto_hide(
    pinned: bool,
    owner: Option<String>,
    current: Option<String>,
    own: String,
) -> bool {
    rules::should_auto_hide(pinned, owner.as_deref(), current.as_deref(), &own)
}

#[uniffi::export]
pub fn plan_replace(owner: Option<String>, current: Option<String>, own: String) -> ReplacePlan {
    rules::plan_replace(owner.as_deref(), current.as_deref(), &own).into()
}

/// `ReplacePlan::NoSource` 时给用户看的话。
#[uniffi::export]
pub fn no_source_message() -> String {
    rules::NO_SOURCE_MESSAGE.to_owned()
}

/// 写回守卫：前台已经换掉时返回拒绝理由，放行时为空。
#[uniffi::export]
pub fn replace_target_error(owner: Option<String>, current: Option<String>) -> Option<String> {
    rules::replace_target_error(owner.as_deref(), current)
}

/// 写入失败（AX 与 ⌘V 都没写进去）时给用户看的话。
#[uniffi::export]
pub fn write_back_failed_message(detail: String) -> String {
    rules::write_back_failed_message(&detail)
}

#[uniffi::export]
impl Engine {
    /// 取词黑名单拦下时的提示，没拦下为空。读设置锁，从后台调用。
    pub fn selection_block_notice(&self, app_name: String) -> Option<String> {
        let settings = self.core.settings.lock().expect("设置锁不应中毒").clone();
        rules::selection_block_notice(&settings, &app_name)
    }
}
