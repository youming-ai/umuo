//! 应用层的状态：两个客户端共用的那一半。
//!
//! 窗口、托盘、快捷键这类状态留在各自的宿主里；这里只放设置、术语表、统计、历史库、
//! HTTP 客户端与请求登记，以及向宿主要平台能力的 [`Host`]。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use umuo_store::Store;

use crate::glossaries::Glossaries;
use crate::host::Host;
use crate::requests::Requests;
use crate::settings::Settings;
use crate::stats::Stats;

pub struct AppCore {
    pub config_dir: PathBuf,
    pub settings: Mutex<Settings>,
    /// settings.json 上次由 [`AppCore::apply_settings_patch`] 读写时的 mtime，与文件不同说明别处改过。
    /// 只在持有 `settings` 锁时读写。其它写设置的地方（按 App 记住目标语言、引导完成）不更新它：
    /// 下次保存时多重载一次内容相同的文件，无害。
    pub(crate) settings_mtime: Mutex<Option<SystemTime>>,
    /// 对比偏好的本地统计（PRD §5.6）。与设置分开存，理由见 `stats.rs`。
    pub stats: Mutex<Stats>,
    /// 术语表（PRD §5.8）。单独一个文件，不塞进 settings.json。
    pub glossaries: Mutex<Glossaries>,
    /// 翻译历史与用量的 SQLite 库（PRD §5.9）。
    ///
    /// `None` = 打开失败。**这时客户端照常启动**——历史不可用不该让整个翻译工具打不开，
    /// 失败原因留在 `store_error` 里给 UI 显示。
    pub store: Mutex<Option<Store>>,
    pub store_error: Option<String>,
    /// 复用一个 HTTP 客户端，让连接池与 TLS 会话能跨请求复用——
    /// 每次翻译新建客户端会白白多付一次 TLS 握手的延迟。
    pub client: reqwest::Client,
    /// 每个窗口当前那次请求的 id 与取消标志（用户按 Esc、或新请求顶掉旧请求）。
    pub requests: Requests,
    pub host: Arc<dyn Host>,
}

impl AppCore {
    /// 读配置目录里的设置、统计、术语表，建 HTTP 客户端，打开并清理历史库。
    ///
    /// 只有 HTTP 客户端建不起来才算失败；代理设置坏了、历史库打不开都照常启动。
    pub fn open(config_dir: PathBuf, host: Arc<dyn Host>) -> Result<Self, String> {
        let settings = Settings::load(&config_dir);
        let settings_mtime = crate::settings_patch::modified(&Settings::path_in(&config_dir));
        let stats = Stats::load(&config_dir);
        let glossaries = Glossaries::load(&config_dir);
        // 客户端按设置里的代理意图构建一次（PRD §8）。改代理需要重启——
        // 重建客户端要换掉所有已发出的连接，运行中做这件事的复杂度
        // 远大于它带来的便利（设置里已写明）。
        // 代理设置有问题**不能让应用起不来**：它是网络配置，不是核心数据。
        // （设置页保存时会当场拦下，所以这条只会被手改过的配置文件触发。）
        let proxy = match settings.proxy_choice() {
            Ok(choice) => choice,
            Err(error) => {
                eprintln!("umuo: 代理设置有问题，这次按「跟随系统」处理：{error}");
                umuo_core::proxy::ProxyChoice::System
            }
        };
        let client = umuo_core::transport::build_client_with(&proxy).map_err(|e| e.to_string())?;

        // 打开历史库并按保留天数清理。失败只记录原因，不让启动失败。
        let (store, store_error) =
            match crate::history::open_and_prune(&config_dir, settings.history_retention_days) {
                Ok((store, pruned)) => {
                    if pruned > 0 {
                        println!("umuo: 按保留策略清理了 {pruned} 条历史");
                    }
                    (Some(store), None)
                }
                Err(error) => {
                    eprintln!("umuo: 历史数据库不可用（翻译功能不受影响）：{error}");
                    (None, Some(error))
                }
            };

        Ok(Self {
            config_dir,
            settings: Mutex::new(settings),
            settings_mtime: Mutex::new(settings_mtime),
            stats: Mutex::new(stats),
            glossaries: Mutex::new(glossaries),
            store: Mutex::new(store),
            store_error,
            client,
            requests: Requests::default(),
            host,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::{self, Draft};

    /// 不碰任何平台 API 的宿主：Swift 版与 Tauri 版之外的第三个实现，证明应用层只依赖 [`Host`]。
    struct FakeHost;

    impl Host for FakeHost {
        fn api_key(&self, provider_id: &str) -> Result<Option<String>, String> {
            Ok((provider_id == "deepseek").then(|| "sk-test".to_string()))
        }
        fn frontmost_app_name(&self) -> Option<String> {
            Some("Safari".to_string())
        }
        fn frontmost_app_token(&self) -> Option<String> {
            Some("pid-1".to_string())
        }
        fn write_back(&self, _: crate::host::FocusSource, _: &str, _: &str) -> Result<(), String> {
            unreachable!("这些测试不写回")
        }
    }

    fn open_in(name: &str) -> AppCore {
        let dir = std::env::temp_dir().join(format!("umuo-app-core-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        AppCore::open(dir, Arc::new(FakeHost)).unwrap()
    }

    fn draft() -> Draft {
        Draft {
            source_text: "hello".into(),
            translated_text: "你好".into(),
            source_lang: Some("en".into()),
            target_lang: "zh-CN".into(),
            provider_id: "openai".into(),
            model: "gpt-4o-mini".into(),
            style_id: "natural".into(),
            scene: "selection".into(),
            input_tokens: 1,
            output_tokens: 1,
            estimated: false,
            cost_usd: Some(0.0),
        }
    }

    #[test]
    fn a_fresh_config_dir_opens_with_defaults_and_a_working_history() {
        let core = open_in("fresh");
        assert!(core.store_error.is_none());
        assert_eq!(
            *core.settings.lock().unwrap(),
            Settings::default(),
            "空目录 = 默认设置"
        );
        assert_eq!(history::with_store(&core, |s| s.count()).unwrap(), 0);
    }

    #[test]
    fn history_takes_the_source_app_from_the_host() {
        let core = open_in("source-app");
        history::record(&core, draft());
        let records = history::with_store(&core, |s| s.recent(10, 0)).unwrap();
        assert_eq!(records[0].entry.source_app.as_deref(), Some("Safari"));
    }

    #[test]
    fn going_over_the_limit_fails_over_to_a_provider_the_host_has_a_key_for() {
        let core = open_in("failover");
        let settings = Settings {
            monthly_limits: vec![umuo_core::budget::ProviderLimit {
                provider_id: "openai".into(),
                limit_usd: 1.0,
                extra: Default::default(),
            }],
            limit_action: umuo_core::budget::LimitAction::Failover,
            ..Settings::default()
        };
        let spent = umuo_core::wire::TokenUsage::default();
        history::record_usage(&core, "openai", "gpt-4o-mini", spent, Some(2.0));

        let resolution = crate::budget::resolve(&core, &settings, "openai");
        // FakeHost 只有 deepseek 的 Key
        assert_eq!(resolution.provider_id, "deepseek");
        assert!(resolution.warning.is_some());
    }

    #[test]
    fn a_broken_proxy_setting_does_not_stop_the_app_from_opening() {
        let dir = std::env::temp_dir().join(format!("umuo-app-core-proxy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("settings.json"),
            r#"{"proxyMode":"custom","proxyUrl":"not a url"}"#,
        )
        .unwrap();
        // 前提：这个地址确实是坏的，否则这条测试什么都没证明
        assert!(Settings::load(&dir).proxy_choice().is_err());
        assert!(AppCore::open(dir, Arc::new(FakeHost)).is_ok());
    }
}
