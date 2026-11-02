//! 供应商目录 —— **声明式数据，不是代码分支**（PRD §6.1）。
//!
//! 新增一家「OpenAI 兼容」供应商的完整成本 = 往 [`PROVIDERS`] 里加一条数据。
//! 只有**协议本身不同**时才需要动 [`crate::wire`]：目前只有三种协议形态
//! （OpenAI Chat Completions / Anthropic Messages / Gemini generateContent）。
//!
//! 关于模型名：各家模型会改名、下架、按账号灰度，任何写死的默认值都会过时。
//! 所以 `suggested_models` 只是**离线兜底**；正常路径是 PRD §6.2 的第 3 步——
//! 拿用户自己的 Key 去调厂商的模型列表接口（[`crate::wire::build_models_request`]），
//! 用真实可用的列表覆盖它。

use serde::Serialize;

/// 线上协议。三种形态覆盖了 V1.0 的全部供应商。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Protocol {
    /// OpenAI Chat Completions。DeepSeek、通义、智谱、Moonshot、OpenRouter、
    /// Ollama、LM Studio 与所有「自定义 OpenAI 兼容端点」都走这条路。
    OpenAi,
    /// Anthropic Messages API。
    Anthropic,
    /// Gemini generateContent / streamGenerateContent。
    Gemini,
    /// Azure OpenAI：请求体与 OpenAI 一致，但路径里是**部署名**并要带 api-version。
    AzureOpenAi,
}

/// 鉴权方式。差异看着琐碎，但每家都把 Key 放在不同位置，猜错就是 401。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Auth {
    /// `Authorization: Bearer <key>`
    Bearer,
    /// `x-api-key: <key>`（Anthropic）
    XApiKey,
    /// `x-goog-api-key: <key>`（Gemini）
    XGoogApiKey,
    /// `api-key: <key>`（Azure OpenAI）。注意不是 Bearer。
    ApiKeyHeader,
}

/// 供应商类别。决定「要不要填 Key」「能不能自动探测端口」。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    /// 云端供应商，必须有 Key。
    Cloud,
    /// 本机模型（Ollama / LM Studio），不需要 Key，自动探测端口（PRD §6.1）。
    Local,
    /// 用户自填 Base URL 的 OpenAI 兼容端点（PRD §6.1 最后一行）。
    Custom,
    /// Azure OpenAI：**必须**由用户填资源终结点，且模型名就是他的部署名。
    Azure,
}

/// 一条供应商数据。全部字段都是静态的，运行时零分配。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Provider {
    /// 稳定 id，会被写进配置与历史库——**改动它等于破坏用户已有数据**。
    pub id: &'static str,
    /// 展示名（供应商自有品牌，不翻译）。
    pub label: &'static str,
    pub protocol: Protocol,
    pub auth: Auth,
    pub kind: ProviderKind,
    /// API Base URL（不含具体路径）。`Custom` 用占位值，运行时由用户配置覆盖。
    pub base_url: &'static str,
    /// 离线兜底的默认模型；空字符串表示「必须先从模型列表里选一个」。
    pub default_model: &'static str,
    pub suggested_models: &'static [&'static str],
    /// 申请 Key 的官方页面，给用户一个入口。
    pub keys_url: &'static str,
    /// 用于 PRD §6.2 的「粘贴 Key 自动推测供应商」。越长的前缀越有判别力。
    pub key_prefixes: &'static [&'static str],
}

impl Provider {
    /// 本地模型不需要 Key，UI 与配置流程据此跳过 Key 输入（PRD §6.1、§7.4）。
    pub fn requires_key(&self) -> bool {
        self.kind != ProviderKind::Local
    }

    /// 这家供应商是否**必须**由用户填 Base URL（Azure 的资源终结点；自定义端点）。
    ///
    /// 界面据此决定要不要显示那个输入框：给 OpenAI 也显示一个地址框，
    /// 用户会以为「不改就填错了」。
    pub fn requires_base_url(&self) -> bool {
        matches!(self.kind, ProviderKind::Azure | ProviderKind::Custom)
    }
}

/// 供应商目录里认不出模型时的保守默认上下文窗口（token）。
///
/// **刻意取得保守。** 估小了只是多切一片、多花一次请求；估大了会直接把
/// 「超过上下文长度」的错误摔在用户脸上。两者的代价不对称，所以宁可小。
pub const DEFAULT_CONTEXT_TOKENS: usize = 8_192;

/// 已知模型的上下文窗口（token），按模型名前缀匹配。
///
/// 表里只放**能改变分片决策**的量级差异（8k / 32k / 64k / 128k / 200k / 1M），
/// 不追求逐版本精确：分片阈值是「上下文的 70%」，同量级内差几千 token 不影响结论。
///
/// 供应商的模型列表接口不返回上下文长度，所以这张表是必要的——
/// 没有它就无法执行 PRD §6.3 的「超过上下文 70% 时切分」。
pub fn context_window_for(model: &str) -> usize {
    let lower = model.trim().to_ascii_lowercase();
    // OpenRouter 的模型名带厂商前缀（`anthropic/claude-haiku-5.5`），按最后一段匹配。
    let name = lower.rsplit('/').next().unwrap_or(&lower);
    if name.is_empty() {
        return DEFAULT_CONTEXT_TOKENS;
    }
    // 顺序有意义：更具体的前缀放前面。
    const TABLE: &[(&str, usize)] = &[
        ("gpt-3.5", 16_385),
        ("gpt-4o", 128_000),
        ("gpt-4.1", 128_000),
        ("gpt-4-turbo", 128_000),
        // gpt-5 系列实际更大（约 400k），按 128k 保守估。
        ("gpt-5", 128_000),
        ("gpt-4", 8_192),
        ("o1", 200_000),
        ("o3", 200_000),
        ("o4", 200_000),
        ("claude", 200_000),
        ("gemini", 1_000_000),
        ("deepseek", 64_000),
        ("qwen", 32_000),
        ("glm", 128_000),
        ("moonshot", 128_000),
        ("kimi", 128_000),
        ("yi-", 16_000),
        // 本地模型（Ollama / LM Studio）的 num_ctx 常被压得很小，
        // 给一个和全局默认一致的保守值，别高估。
        ("llama", DEFAULT_CONTEXT_TOKENS),
        ("mistral", DEFAULT_CONTEXT_TOKENS),
        ("phi", DEFAULT_CONTEXT_TOKENS),
        ("gemma", DEFAULT_CONTEXT_TOKENS),
    ];
    TABLE
        .iter()
        .find(|(prefix, _)| name.starts_with(prefix))
        .map(|(_, tokens)| *tokens)
        .unwrap_or(DEFAULT_CONTEXT_TOKENS)
}

/// 内置供应商目录。
///
/// 排序即 UI 上的默认顺序：先放最常用的云端，再放本地与自定义。
pub const PROVIDERS: &[Provider] = &[
    Provider {
        id: "openai",
        label: "OpenAI",
        protocol: Protocol::OpenAi,
        auth: Auth::Bearer,
        kind: ProviderKind::Cloud,
        base_url: "https://api.openai.com/v1",
        default_model: "gpt-4o-mini",
        suggested_models: &["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
        keys_url: "https://platform.openai.com/api-keys",
        key_prefixes: &["sk-proj-", "sk-svcacct-", "sk-"],
    },
    Provider {
        // Azure OpenAI（PRD §6.1「含 Azure OpenAI 部署」）。
        //
        // 三处与 OpenAI 原生不同，且都不能靠"兼容模式"绕开：
        // ① 地址是用户的资源终结点（必须自己填）；② 鉴权头是 `api-key` 而非 Bearer；
        // ③ 路径里放的是**部署名**，还要求每个请求带 `api-version`。
        id: "azure",
        label: "Azure OpenAI",
        protocol: Protocol::AzureOpenAi,
        auth: Auth::ApiKeyHeader,
        kind: ProviderKind::Azure,
        // 空地址：必须由用户填写自己的资源终结点，我们无法猜。
        base_url: "",
        // 空模型：Azure 的"模型"是用户自己起的部署名。
        default_model: "",
        suggested_models: &[],
        keys_url: "https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI",
        // Azure Key 是 32 位十六进制，没有可辨识前缀——不猜，让用户手选。
        key_prefixes: &[],
    },
    Provider {
        id: "anthropic",
        label: "Anthropic",
        protocol: Protocol::Anthropic,
        auth: Auth::XApiKey,
        kind: ProviderKind::Cloud,
        base_url: "https://api.anthropic.com/v1",
        // 用不带日期的别名；但别名也会随模型一起退役（3.5 系列已下线），换代时要跟着改。
        default_model: "claude-haiku-5-5",
        suggested_models: &["claude-haiku-5-5", "claude-sonnet-5-5"],
        keys_url: "https://console.anthropic.com/settings/keys",
        key_prefixes: &["sk-ant-"],
    },
    Provider {
        id: "gemini",
        label: "Google Gemini",
        protocol: Protocol::Gemini,
        auth: Auth::XGoogApiKey,
        kind: ProviderKind::Cloud,
        base_url: "https://generativelanguage.googleapis.com/v1beta",
        // gemini-2.0-flash 已弃用；2.5 系列是当前的稳定版。
        default_model: "gemini-2.5-flash",
        suggested_models: &["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
        keys_url: "https://aistudio.google.com/apikey",
        key_prefixes: &["AIza"],
    },
    Provider {
        id: "deepseek",
        label: "DeepSeek",
        protocol: Protocol::OpenAi,
        auth: Auth::Bearer,
        kind: ProviderKind::Cloud,
        base_url: "https://api.deepseek.com/v1",
        default_model: "deepseek-chat",
        suggested_models: &["deepseek-chat", "deepseek-reasoner"],
        keys_url: "https://platform.deepseek.com/api_keys",
        // DeepSeek 的 Key 也是 sk- 开头，与 OpenAI 无法靠前缀区分——
        // 推测层会把两家都列为候选，由用户确认（PRD §6.2 第 2 步）。
        key_prefixes: &["sk-"],
    },
    Provider {
        id: "qwen",
        label: "通义千问",
        protocol: Protocol::OpenAi,
        auth: Auth::Bearer,
        kind: ProviderKind::Cloud,
        base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        default_model: "qwen-plus",
        suggested_models: &["qwen-plus", "qwen-turbo", "qwen-max"],
        keys_url: "https://bailian.console.aliyun.com/?apiKey=1",
        key_prefixes: &["sk-"],
    },
    Provider {
        id: "zhipu",
        label: "智谱 GLM",
        protocol: Protocol::OpenAi,
        auth: Auth::Bearer,
        kind: ProviderKind::Cloud,
        base_url: "https://open.bigmodel.cn/api/paas/v4",
        default_model: "glm-4-flash",
        suggested_models: &["glm-4-flash", "glm-4-plus"],
        keys_url: "https://open.bigmodel.cn/usercenter/apikeys",
        // 智谱的 Key 形如 `{id}.{secret}`，没有可判别的前缀。
        key_prefixes: &[],
    },
    Provider {
        id: "moonshot",
        label: "Moonshot / Kimi",
        protocol: Protocol::OpenAi,
        auth: Auth::Bearer,
        kind: ProviderKind::Cloud,
        base_url: "https://api.moonshot.cn/v1",
        default_model: "moonshot-v1-8k",
        suggested_models: &["moonshot-v1-8k", "moonshot-v1-32k"],
        keys_url: "https://platform.moonshot.cn/console/api-keys",
        key_prefixes: &["sk-"],
    },
    Provider {
        id: "openrouter",
        label: "OpenRouter",
        protocol: Protocol::OpenAi,
        auth: Auth::Bearer,
        kind: ProviderKind::Cloud,
        base_url: "https://openrouter.ai/api/v1",
        default_model: "openai/gpt-4o-mini",
        suggested_models: &[
            "openai/gpt-4o-mini",
            "anthropic/claude-haiku-5.5",
            "google/gemini-2.5-flash",
        ],
        keys_url: "https://openrouter.ai/keys",
        key_prefixes: &["sk-or-"],
    },
    Provider {
        id: "ollama",
        label: "Ollama（本机）",
        protocol: Protocol::OpenAi,
        auth: Auth::Bearer,
        kind: ProviderKind::Local,
        // Ollama 的 OpenAI 兼容层在 /v1；它的原生 API（/api/tags）在根路径下。
        base_url: "http://localhost:11434/v1",
        // 本地模型因人而异，没有合理的静态默认值——必须从 /v1/models 里选。
        default_model: "",
        suggested_models: &[],
        keys_url: "https://ollama.com/download",
        key_prefixes: &[],
    },
    Provider {
        id: "lmstudio",
        label: "LM Studio（本机）",
        protocol: Protocol::OpenAi,
        auth: Auth::Bearer,
        kind: ProviderKind::Local,
        base_url: "http://localhost:1234/v1",
        default_model: "",
        suggested_models: &[],
        keys_url: "https://lmstudio.ai/",
        key_prefixes: &[],
    },
    Provider {
        id: "custom",
        label: "自定义端点",
        protocol: Protocol::OpenAi,
        auth: Auth::Bearer,
        kind: ProviderKind::Custom,
        // 占位：真正的 Base URL 来自用户配置。
        base_url: "",
        default_model: "",
        suggested_models: &[],
        keys_url: "",
        key_prefixes: &[],
    },
];

/// 默认供应商：第一次启动、还没配置任何模型时的落点。
pub fn default_provider() -> &'static Provider {
    &PROVIDERS[0]
}

/// 按 id 找供应商。找不到返回 `None`——刻意不做「回落默认」，
/// 因为配置里出现未知 id 是数据损坏，静默换一家会让用户以为自己在用 A、其实在用 B。
pub fn find_provider(id: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|p| p.id == id)
}

#[cfg(test)]
mod context_tests {
    use super::*;

    #[test]
    fn known_model_families_map_to_their_window() {
        assert_eq!(context_window_for("gpt-4o"), 128_000);
        assert_eq!(context_window_for("gpt-4o-mini"), 128_000);
        assert_eq!(context_window_for("claude-sonnet-4-5"), 200_000);
        assert_eq!(context_window_for("gemini-2.5-pro"), 1_000_000);
        assert_eq!(context_window_for("deepseek-chat"), 64_000);
    }

    #[test]
    fn a_specific_prefix_is_checked_before_a_shorter_one() {
        // `gpt-4.1` 必须先于 `gpt-4` 被匹配，否则它会被当成 8k 的老 gpt-4，
        // 于是每 5k 字符就切一片——功能没错，但白白多花请求。
        assert_eq!(context_window_for("gpt-4.1-mini"), 128_000);
        assert_eq!(context_window_for("gpt-4-turbo"), 128_000);
        assert_eq!(context_window_for("gpt-4"), 8_192);
    }

    #[test]
    fn matching_is_case_insensitive_and_trims() {
        assert_eq!(context_window_for("  GPT-4O  "), 128_000);
        assert_eq!(context_window_for("Claude-3-5-Sonnet"), 200_000);
    }

    #[test]
    fn an_unknown_model_gets_the_conservative_default() {
        // 估小了只是多切一片；估大了会把「超过上下文长度」摔在用户脸上。
        assert_eq!(
            context_window_for("my-gateway-internal-v3"),
            DEFAULT_CONTEXT_TOKENS
        );
        assert_eq!(context_window_for(""), DEFAULT_CONTEXT_TOKENS);
        assert_eq!(context_window_for("   "), DEFAULT_CONTEXT_TOKENS);
    }

    #[test]
    fn local_models_are_not_overestimated() {
        // Ollama 的 num_ctx 常被压到 2k–8k，按 128k 估会直接把请求打爆。
        assert_eq!(context_window_for("llama3.1:8b"), DEFAULT_CONTEXT_TOKENS);
        // OpenRouter 的厂商前缀不能让匹配落空
        assert_eq!(context_window_for("anthropic/claude-haiku-5.5"), 200_000);
        assert_eq!(context_window_for("openai/gpt-5.4-mini"), 128_000);
        assert_eq!(context_window_for("mistral-nemo"), DEFAULT_CONTEXT_TOKENS);
    }

    #[test]
    fn the_default_is_smaller_than_every_known_family() {
        // 默认值必须是「最保守」的那一档，否则它就失去了兜底的意义。
        for model in [
            "gpt-4o",
            "claude-3-5-sonnet",
            "gemini-2.5-pro",
            "deepseek-chat",
        ] {
            assert!(
                context_window_for(model) >= DEFAULT_CONTEXT_TOKENS,
                "{model} 的窗口比默认值还小，说明表里有问题"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn provider_ids_are_unique() {
        // id 会被写进用户配置与历史库，重复即数据损坏。
        let mut seen = HashSet::new();
        for p in PROVIDERS {
            assert!(seen.insert(p.id), "供应商 id 重复：{}", p.id);
        }
    }

    #[test]
    fn cloud_providers_are_fully_specified() {
        for p in PROVIDERS.iter().filter(|p| p.kind == ProviderKind::Cloud) {
            assert!(!p.label.is_empty(), "{} 缺展示名", p.id);
            assert!(
                p.base_url.starts_with("https://"),
                "{} 的 Base URL 必须是 https",
                p.id
            );
            assert!(!p.default_model.is_empty(), "{} 缺默认模型", p.id);
            assert!(!p.keys_url.is_empty(), "{} 缺申请 Key 的入口", p.id);
            assert!(p.requires_key(), "{} 是云端供应商，必须有 Key", p.id);
        }
    }

    #[test]
    fn azure_requires_an_endpoint_and_the_user_supplies_both_url_and_deployment() {
        // Azure 与"云端供应商"那一类不同：地址与模型都必须由用户填，
        // 所以它单独一类，不能套用 Cloud 的不变量（那条要求 base_url 非空）。
        let azure = find_provider("azure").expect("Azure 应当在目录里");
        assert_eq!(azure.kind, ProviderKind::Azure);
        assert!(azure.requires_key(), "Azure 需要 Key");
        assert!(azure.requires_base_url(), "Azure 必须由用户填资源终结点");
        assert!(azure.base_url.is_empty(), "我们无法猜用户的资源终结点");
        assert!(azure.default_model.is_empty(), "模型名是用户的部署名");
        assert!(!azure.keys_url.is_empty(), "要给出去哪儿申请 Key");
        assert!(azure.key_prefixes.is_empty(), "32 位十六进制没有可辨识前缀");
    }

    #[test]
    fn only_azure_and_custom_demand_a_base_url() {
        for p in PROVIDERS {
            let expected = matches!(p.kind, ProviderKind::Azure | ProviderKind::Custom);
            assert_eq!(p.requires_base_url(), expected, "{} 的判定不对", p.id);
        }
    }

    #[test]
    fn default_model_is_always_among_suggestions() {
        // 否则 UI 的模型下拉框会显示一个列表里没有的值。
        for p in PROVIDERS {
            if p.default_model.is_empty() {
                continue;
            }
            assert!(
                p.suggested_models.contains(&p.default_model),
                "{} 的默认模型 {} 不在建议列表里",
                p.id,
                p.default_model
            );
        }
    }

    #[test]
    fn local_providers_need_no_key_and_have_no_static_model() {
        for p in PROVIDERS.iter().filter(|p| p.kind == ProviderKind::Local) {
            assert!(!p.requires_key(), "{} 是本机模型，不该要求 Key", p.id);
            // 本机有什么模型只有探测了才知道，写死一个会误导用户。
            assert!(p.default_model.is_empty(), "{} 不该有静态默认模型", p.id);
        }
    }

    #[test]
    fn unknown_id_does_not_fall_back_to_default() {
        assert!(find_provider("totally-made-up").is_none());
        assert_eq!(find_provider("deepseek").unwrap().label, "DeepSeek");
        assert_eq!(default_provider().id, "openai");
    }

    #[test]
    fn anthropic_uses_its_own_header_auth() {
        // 猜错鉴权方式就是 401，所以这条断言值得钉住。
        let anthropic = find_provider("anthropic").unwrap();
        assert_eq!(anthropic.auth, Auth::XApiKey);
        assert_eq!(anthropic.protocol, Protocol::Anthropic);
    }
}
