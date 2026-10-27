//! umuo 共享翻译内核。
//!
//! 这一层承担 PRD §9 里「共享核心」的全部职责：翻译逻辑与数据。
//! 两条硬约束：
//!
//! 1. **不依赖任何操作系统 API**（也就不能用 Tauri、不能用 `objc2`）。
//!    取词、写回、截图、快捷键、凭据存储这些能力全部走 trait，由平台适配层实现。
//!    因此本 crate 能在 Linux CI 上直接 `cargo test`。
//! 2. **Provider 是数据不是分支**（PRD §6.1）。新增一家供应商 = 往
//!    [`provider::PROVIDERS`] 里加一条数据；只有协议本身不同（OpenAI 兼容 /
//!    Anthropic Messages / Gemini）才需要动 [`wire`]。
//!
//! 模块划分与 PRD 的对应关系：
//!
//! | 模块 | 职责 | PRD |
//! | --- | --- | --- |
//! | [`provider`] | 供应商目录、协议与鉴权描述 | §6.1 |
//! | [`key_detect`] | 按 Key 前缀推测供应商 | §6.2 |
//! | [`wire`] | 请求构造、流式事件解析、错误分类 | §6.5、§7.5 |
//! | [`prompt`] | 内部翻译指令与语言信息 | §5.7、§6.5 |
//! | [`chunk`] | 长文本按上下文切分 | §6.3 |
//! | [`usage`] | Token 计量 | §6.5 |
//! | [`lang`] | 语言判断与「源=目标」时的切换规则 | §5.2 |
//! | [`word_card`] | 单词模式判定与词卡结构 | §5.2 |
//! | [`transport`] | HTTP 发送与流式读取（唯一碰网络的地方） | §6.3、§8 |

/// 持久化结构里本版本不认识的字段：读进来原样保留、保存时原样写回。
///
/// 新版本加的字段，用户回到旧版本改一次设置就会被抹掉——
/// 升级再降级、两个客户端交替用都会丢数据。用法是 `#[serde(flatten)] pub extra: UnknownFields`；
/// 为空时不输出任何键，现有的序列化结果不变。
pub type UnknownFields = serde_json::Map<String, serde_json::Value>;

pub mod chunk;
pub mod error;
pub mod hotkey;
pub mod key_detect;
pub mod lang;
pub mod prompt;
pub mod provider;
pub mod proxy;
pub mod transport;
pub mod usage;
pub mod wire;
pub mod word_card;

pub use error::{CoreError, SuggestedAction};
