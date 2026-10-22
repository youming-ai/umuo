//! macOS 发音朗读。
//!
//! 用系统自带的 `/usr/bin/say` 子进程，而不是进程内的 `AVSpeechSynthesizer`。
//! 理由是**可判定性**：
//!
//! - `AVSpeechSynthesizer` 需要一个 run loop 才真正开口。Tauri 的命令跑在哪个线程上
//!   并不由我们决定，把它接到主线程上又要引入一层调度——而这属于「写错了只有真人
//!   按一下才知道」的那类问题。
//! - `say` 是一个独立进程：有没有在说话、能不能停，都是可观测、可测试的。
//!
//! 代价是每次朗读起一个进程（几十毫秒），以及依赖 `say` 这个系统命令的存在
//! （macOS 自带，路径固定）。

use std::process::{Child, Command};
use std::sync::{Mutex, OnceLock};

use umuo_platform::speech::{parse_voices, pick_voice, to_speech_text, Voice};
use umuo_platform::{PlatformError, Speech};

pub struct MacSpeech {
    /// 当前正在朗读的子进程。`None` = 没在朗读。
    child: Mutex<Option<Child>>,
}

/// 系统装了哪些发音人。查询一次就缓存——它在一台机器上不会变，
/// 而 `say -v '?'` 要跑一百多毫秒，每次朗读都查一遍没必要。
static VOICES: OnceLock<Vec<Voice>> = OnceLock::new();

fn installed_voices() -> &'static [Voice] {
    VOICES.get_or_init(|| {
        let Ok(output) = Command::new("/usr/bin/say").arg("-v").arg("?").output() else {
            return Vec::new();
        };
        parse_voices(&String::from_utf8_lossy(&output.stdout))
    })
}

impl MacSpeech {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

impl Default for MacSpeech {
    fn default() -> Self {
        Self::new()
    }
}

/// `say` 的参数。文本前面一定要有 `--`：译文常以 `-` 开头（Markdown 列表「- 第一点」），
/// 不加的话 `say` 会把它当成选项——轻则报 invalid option 不出声，
/// 重则选中「-o/路径」按 ⌥R 会把那个文件覆盖成一段空录音。抽成纯函数是为了能测。
fn say_args(voice: Option<&str>, spoken: &str) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(voice) = voice {
        args.extend(["-v".to_string(), voice.to_string()]);
    }
    args.extend(["--".to_string(), spoken.to_string()]);
    args
}

/// 停掉一个朗读进程。kill 之后再 wait：不 wait 会留下僵尸进程。
fn reap(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

impl Speech for MacSpeech {
    fn speak(&self, text: &str, language: Option<&str>) -> Result<(), PlatformError> {
        let spoken = to_speech_text(text);
        if spoken.is_empty() {
            // 只念空白的输入没有意义，但也不该被当成错误——调用方可能只是选中了符号。
            return Ok(());
        }

        // 「停上一段 → 起新的一段 → 存起来」在同一把锁里做完：分开做的话，两次并发的朗读
        // 都能在对方存入之前停掉「上一段」，结果两段叠着念，而且先起的那段再也停不掉。
        let mut current = self.child.lock().expect("朗读锁不应中毒");
        // 先停掉上一段：两段声音叠在一起比「后一次没生效」更让人烦躁。
        if let Some(previous) = current.take() {
            reap(previous);
        }

        // 按系统**实际装了**的发音人来挑，而不是按一张硬编码的名字表——
        // 本机实测那张表里 8 个有 3 个没装，猜错的结果是「按了没反应」。
        let voice = language.and_then(|code| pick_voice(installed_voices(), code));
        let child = Command::new("/usr/bin/say")
            .args(say_args(voice, &spoken))
            .spawn()
            .map_err(|e| PlatformError::Other(format!("无法启动朗读：{e}")))?;

        *current = Some(child);
        Ok(())
    }

    fn stop(&self) -> Result<(), PlatformError> {
        if let Some(child) = self.child.lock().expect("朗读锁不应中毒").take() {
            reap(child);
        }
        Ok(())
    }
}

impl Drop for MacSpeech {
    fn drop(&mut self) {
        // 客户端退出时若还在朗读，`say` 会变成一个被遗弃的进程继续说话。
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.take() {
                reap(child);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stopping_when_nothing_is_speaking_is_not_an_error() {
        // 「停」应当是幂等的：用户可能连点两次停止。
        let speech = MacSpeech::new();
        assert!(speech.stop().is_ok());
        assert!(speech.stop().is_ok());
    }

    #[test]
    fn text_starting_with_a_dash_is_never_read_as_an_option() {
        // 「-o/路径」不加 `--` 会被 say 当成「输出到文件」。
        assert_eq!(say_args(None, "-o/tmp/x"), ["--", "-o/tmp/x"]);
        assert_eq!(
            say_args(Some("Tingting"), "- 第一点"),
            ["-v", "Tingting", "--", "- 第一点"]
        );
    }

    #[test]
    fn speaking_nothing_returns_ok_without_starting_a_process() {
        let speech = MacSpeech::new();
        assert!(speech.speak("   \n  ", Some("zh-CN")).is_ok());
        assert!(speech.child.lock().unwrap().is_none(), "不该起进程");
    }

    #[test]
    #[ignore = "需要真实系统语音，手动运行：cargo test -p umuo-platform-macos -- --ignored --nocapture"]
    fn the_supported_languages_all_resolve_to_an_installed_voice() {
        // 这条在真机上验证「按语言挑发音人」确实挑得到——
        // 只靠 fixture 测不出「这台机器装了什么」。
        let voices = installed_voices();
        assert!(!voices.is_empty(), "系统应当至少装了一个发音人");
        println!("系统共 {} 个发音人", voices.len());
        for code in ["zh-CN", "zh-TW", "ja", "en", "ko"] {
            let picked = pick_voice(voices, code);
            println!("  {code:6} → {picked:?}");
            assert!(picked.is_some(), "{code} 应当能挑到发音人");
        }
    }

    #[test]
    #[ignore = "会真的发出声音，手动运行：cargo test -p umuo-platform-macos -- --ignored"]
    fn speaking_then_stopping_actually_runs_say() {
        let speech = MacSpeech::new();
        speech
            .speak("umuo 朗读测试", Some("zh-CN"))
            .expect("应当能启动朗读");
        assert!(speech.child.lock().unwrap().is_some(), "应当有子进程");
        speech.stop().expect("应当能停下");
        assert!(speech.child.lock().unwrap().is_none(), "停下后不该留进程");
    }
}
