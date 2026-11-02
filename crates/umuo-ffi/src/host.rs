//! Swift 实现的宿主能力，以及把它接到 `umuo_app::Host` 上的适配器。
//!
//! 四个方法与 `umuo_app::Host` 一一对应，**全部同步**：流水线在 tokio 工作线程上调用它们，
//! `BridgeHost` 用 `block_in_place` 包住每次调用，回调慢了也不会占住工作线程、拖停其他流和取消轮询。
//! `write_back` 也是同步的：`umuo_app::Host::write_back` 在流水线的 future 里直接调用，
//! 做成 async 就得在运行时里 `block_on`。
//! **注意：Swift 的实现绝不能 `DispatchQueue.main.sync` 等待主线程**（主线程也会同步调用 `Engine` 方法，互等即死锁）。

use std::sync::Arc;

use tokio::task::block_in_place;

use umuo_app::host::FocusSource as AppFocusSource;

/// 宿主回调失败。Swift 端抛出的错误都落到这里。
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum HostFailure {
    #[error("{detail}")]
    Failed { detail: String },
}

/// foreign trait 的错误类型必须能接住「Swift 端抛了意料之外的错误」，否则编译不过。
impl From<uniffi::UnexpectedUniFFICallbackError> for HostFailure {
    fn from(error: uniffi::UnexpectedUniFFICallbackError) -> Self {
        Self::Failed {
            detail: error.reason,
        }
    }
}

/// 静默翻译的原文读自哪里，写回时据此替换同样的范围（PRD §5.4）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FocusSource {
    Selection,
    WholeField,
}

impl From<FocusSource> for AppFocusSource {
    fn from(source: FocusSource) -> Self {
        match source {
            FocusSource::Selection => Self::Selection,
            FocusSource::WholeField => Self::WholeField,
        }
    }
}

impl From<AppFocusSource> for FocusSource {
    fn from(source: AppFocusSource) -> Self {
        match source {
            AppFocusSource::Selection => Self::Selection,
            AppFocusSource::WholeField => Self::WholeField,
        }
    }
}

/// Swift 端的宿主。语义见 `umuo_app::Host` 的同名方法。
///
/// 都在 tokio 工作线程上同步调用，要快：前台应用的名字可以读加锁的缓存；
/// 但 `frontmost_app_token` 必须调用时现查（AX 系统级 `AXFocusedApplication` 的 pid），
/// 它是写回守卫的唯一依据，读晚到的 NSWorkspace 缓存会把译文写进刚切过去的应用。
/// **不要等用户操作**（例如会弹 Keychain 授权框的读取）：调用期间这一次请求整个停住，取消也要等它返回。
#[uniffi::export(foreign)]
pub trait HostBridge: Send + Sync {
    /// 某个供应商的 API Key（Keychain：service `app.umuo.desktop`，account = 供应商 id）。
    fn api_key(&self, provider_id: String) -> Result<Option<String>, HostFailure>;
    /// 前台应用的显示名（历史里的「来源应用」）。
    fn frontmost_app_name(&self) -> Option<String>;
    /// 前台应用的标识（pid）。写回守卫拿它与取词时记下的比对。调用时现查 AX，不读缓存。
    fn frontmost_app_token(&self) -> Option<String>;
    /// 静默翻译的写回。只在翻译成功、守卫放行之后调用一次。
    fn write_back(
        &self,
        source: FocusSource,
        original: String,
        text: String,
    ) -> Result<(), HostFailure>;
}

/// 把 Swift 的 [`HostBridge`] 当作 `umuo_app::Host` 用。
pub(crate) struct BridgeHost(pub Arc<dyn HostBridge>);

///
/// 每次回调都包在 `block_in_place` 里：在 Engine 的多线程运行时上，当前工作线程先把手上的其他任务
/// 交出去再阻塞；不在运行时里（同步的 Engine 方法）就直接调用。不能用在 current_thread 运行时上（会 panic），
/// 而 Engine 只建多线程运行时。
impl umuo_app::Host for BridgeHost {
    fn api_key(&self, provider_id: &str) -> Result<Option<String>, String> {
        let provider_id = provider_id.to_string();
        block_in_place(|| self.0.api_key(provider_id)).map_err(|e| e.to_string())
    }
    fn frontmost_app_name(&self) -> Option<String> {
        block_in_place(|| self.0.frontmost_app_name())
    }
    fn frontmost_app_token(&self) -> Option<String> {
        block_in_place(|| self.0.frontmost_app_token())
    }
    fn write_back(&self, source: AppFocusSource, original: &str, text: &str) -> Result<(), String> {
        let (original, text) = (original.to_string(), text.to_string());
        block_in_place(|| self.0.write_back(source.into(), original, text))
            .map_err(|e| e.to_string())
    }
}
