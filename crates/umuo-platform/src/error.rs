//! 平台层错误。
//!
//! 与 [`umuo_core::CoreError`] 分开是刻意的：核心错误描述「翻译为什么失败」，
//! 这里的错误描述「操作系统为什么不让我读到你选中的字」。两者的用户动作
//! 完全不同（前者去改模型配置，后者去开系统权限），混在一个枚举里迟早会串。

/// 平台能力失败。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PlatformError {
    /// 缺少系统权限。PRD §7.4 要求引导用户去开，所以这个变体必须能被单独识别。
    #[error("需要系统权限：{capability}")]
    PermissionDenied { capability: &'static str },

    #[error("没有检测到选中的文本")]
    NoSelection,

    /// 聚焦的元素不可写（只读文本、终端缓冲区等），或写入被拒绝。
    #[error("当前位置不可写入：{detail}")]
    NotWritable { detail: &'static str },

    #[error("剪贴板不可用：{0}")]
    Clipboard(String),

    #[error("凭据存储不可用：{0}")]
    SecretStore(String),

    /// 当前平台还没有实现这个能力。接入新平台时，未实现的能力应该明确报错，
    /// 而不是悄悄返回空字符串——后者会让用户以为「这个功能坏了」。
    #[error("{capability} 在当前平台尚未实现")]
    Unsupported { capability: &'static str },

    #[error("{0}")]
    Other(String),
}

impl PlatformError {
    /// 是否属于「让用户去开系统权限就能解决」的错误。
    pub fn is_permission_problem(&self) -> bool {
        matches!(self, PlatformError::PermissionDenied { .. })
    }
}
