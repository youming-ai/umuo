//! 本地语音模型的固定清单与资源策略（阶段 B 定案，见 `docs/research/local-transcription-engines.md`）。
//!
//! 下载、校验、加载与卸载是宿主（Swift）的事：网络用系统的 URLSession（沿用系统代理）、
//! 推理用 `TranscribeCpp.xcframework`。这里只放**一份**不会漂移的事实：去哪里下、多大、哈希是多少、
//! 放在哪个目录、空闲多久卸载。Swift 经 umuo-ffi 读它，不另写一份常量。

use std::path::{Path, PathBuf};

/// 一份可下载的语音模型。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VoiceModel {
    /// 稳定标识（与 `scripts/asr-eval.ts` 的候选 id 一致）。
    pub id: &'static str,
    /// Hugging Face 仓库。
    pub repo: &'static str,
    /// 固定的 commit：上游改了文件也不会悄悄换掉我们校验过的那一份。
    pub revision: &'static str,
    /// 文件名，也是本地落盘的名字。
    pub file_name: &'static str,
    /// 精确字节数：下载中途超出、结束时不等都按失败处理。
    pub size_bytes: u64,
    /// 小写十六进制 SHA-256。没有通过校验的文件不会出现在最终路径上。
    pub sha256: &'static str,
    /// 权重许可（随「关于」与 THIRD_PARTY_NOTICES 署名）。
    pub license: &'static str,
}

impl VoiceModel {
    /// 固定 revision 的直链。
    pub fn url(&self) -> String {
        format!(
            "https://huggingface.co/{}/resolve/{}/{}",
            self.repo, self.revision, self.file_name
        )
    }
}

/// 默认模型：`Qwen3-ASR-0.6B-Q4_K_M.gguf`（562.3 MiB，Apache-2.0）。
pub const DEFAULT_MODEL: VoiceModel = VoiceModel {
    id: "qwen3-asr-0.6b-q4_k_m",
    repo: "handy-computer/Qwen3-ASR-0.6B-gguf",
    revision: "7e7c69a577fa2725dfedbe34b5e999336e30a19b",
    file_name: "Qwen3-ASR-0.6B-Q4_K_M.gguf",
    size_bytes: 589_560_480,
    sha256: "5b58f32a58ffa2c8783e0b0963485623e286e6272d953dfc9e28bc3447dee0c0",
    license: "Apache-2.0",
};

/// 引擎版本：`TranscribeCpp.xcframework` 的 `transcribe_version()` 应当返回它（selftest 对账）。
pub const ENGINE_VERSION: &str = "0.4.1";

/// 模型空闲多久自动卸载（秒）。阶段 B 实测：卸载后 `phys_footprint` 立即回落约 224 MB，
/// 重新加载约 110 ms，所以 5 分钟足以覆盖连续口述，又不让 300 MB 常驻。
pub const IDLE_UNLOAD_SECS: u64 = 300;

/// 模型目录：配置目录下的 `models/`（Handy 同一做法）。不放进缓存目录——系统清理缓存会让用户再下 562 MB。
pub fn models_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("models")
}

/// 下载中的临时文件：与最终文件同目录（原子改名不跨卷），失败时留着供续传。
pub fn partial_path(config_dir: &Path, model: &VoiceModel) -> PathBuf {
    models_dir(config_dir).join(format!("{}.partial", model.file_name))
}

/// 校验通过后的最终路径。
pub fn model_path(config_dir: &Path, model: &VoiceModel) -> PathBuf {
    models_dir(config_dir).join(model.file_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_model_is_the_one_measured_in_stage_b() {
        // 与研究文档、scripts/asr-eval.ts 的 CANDIDATE_MODELS 同一组数字；改任何一个都要重新实测。
        assert_eq!(DEFAULT_MODEL.size_bytes, 589_560_480);
        assert_eq!(DEFAULT_MODEL.sha256.len(), 64);
        assert!(DEFAULT_MODEL
            .sha256
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert!(DEFAULT_MODEL.revision.starts_with("7e7c69a5"));
        assert_eq!(
            DEFAULT_MODEL.url(),
            "https://huggingface.co/handy-computer/Qwen3-ASR-0.6B-gguf/resolve/\
             7e7c69a577fa2725dfedbe34b5e999336e30a19b/Qwen3-ASR-0.6B-Q4_K_M.gguf"
        );
    }

    #[test]
    fn models_live_next_to_the_settings() {
        let dir = Path::new("/Users/someone/Library/Application Support/app.umuo.desktop");
        assert_eq!(
            model_path(dir, &DEFAULT_MODEL),
            dir.join("models/Qwen3-ASR-0.6B-Q4_K_M.gguf")
        );
        assert_eq!(
            partial_path(dir, &DEFAULT_MODEL),
            dir.join("models/Qwen3-ASR-0.6B-Q4_K_M.gguf.partial")
        );
    }
}
