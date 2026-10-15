//! 开机启动（PRD §7.3 通用）。
//!
//! macOS 上不引插件，直接写一个 **LaunchAgent** plist 到
//! `~/Library/LaunchAgents/`——这是系统原生、可被用户自己检查（甚至手改）的做法。
//! 引 `tauri-plugin-autostart` 也能做，但为了一个几十行的文件多一个依赖不划算。
//!
//! 卸载 = 删掉那个文件。不留任何系统级状态、不改注册表式的全局配置。

use std::io;
use std::path::{Path, PathBuf};

/// LaunchAgent 的 Label。同时也是文件名前缀——与 bundle id 保持一致，
/// 用户在 `launchctl list` 里一眼能认出是谁。
pub const LABEL: &str = "app.umuo.desktop";

/// plist 内容。纯函数，便于测试**转义**——程序路径里带 `&` 或 `<` 时
/// 不转义会生成一个 XML 损坏的文件，而 LaunchAgent 只会静默不生效。
pub fn launch_agent_plist(exec_path: &Path) -> String {
    let program = escape_xml(&exec_path.to_string_lossy());
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{program}</string>
  </array>
  <!-- RunAtLoad：登录时启动。KeepAlive 刻意不开——
       用户主动退出客户端之后，系统不该把它拉回来。 -->
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
"#
    )
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// plist 的落点：`<home>/Library/LaunchAgents/<label>.plist`。
pub fn plist_path(home: &Path) -> PathBuf {
    home.join("Library")
        .join("LaunchAgents")
        .join(format!("{LABEL}.plist"))
}

/// 现在是不是开着。判据就是文件在不在——不查 `launchctl`，
/// 因为那是另一个进程的输出，会把"文件在但服务没加载"变成两种不一致的状态。
pub fn is_enabled(home: &Path) -> bool {
    plist_path(home).is_file()
}

/// 打开或关闭。
pub fn set_enabled(home: &Path, exec_path: &Path, enabled: bool) -> io::Result<()> {
    let path = plist_path(home);
    if !enabled {
        return match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            // 本来就没有 = 已经是想要的状态。
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        };
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, launch_agent_plist(exec_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("umuo-autostart-{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_plist_has_the_keys_launchd_actually_needs() {
        let plist = launch_agent_plist(Path::new("/Applications/umuo.app/Contents/MacOS/umuo"));
        assert!(plist.contains(&format!("<string>{LABEL}</string>")));
        assert!(plist.contains("<key>RunAtLoad</key>"));
        assert!(plist.contains("<true/>"));
        // 程序路径原样在里面，登录时才会启动**这个**二进制。
        assert!(plist.contains("/Applications/umuo.app/Contents/MacOS/umuo"));
        // 不能**启用** KeepAlive：用户主动退出后不该被系统拉回来。
        // 断言用元素形式而不是裸词——文件里的说明注释本来就该提到它，
        // 断言裸词会把注释一起判失败（这条测试第一版就是这么挂的）。
        assert!(!plist.contains("<key>KeepAlive</key>"));
    }

    #[test]
    fn a_path_with_xml_metacharacters_is_escaped() {
        // 不转义会生成 XML 损坏的文件，而 LaunchAgent 只会**静默**不生效——
        // 用户看到开关是开的，其实什么都没发生。
        let plist = launch_agent_plist(Path::new("/Users/a&b/My <App>/umuo"));
        assert!(plist.contains("a&amp;b"));
        assert!(plist.contains("My &lt;App&gt;"));
        assert!(!plist.contains("a&b"));
    }

    #[test]
    fn enabling_writes_the_file_and_disabling_removes_it() {
        let dir = home("cycle");
        let exec = Path::new("/usr/local/bin/umuo");

        assert!(!is_enabled(&dir), "初始应当是关的");
        set_enabled(&dir, exec, true).unwrap();
        assert!(is_enabled(&dir));
        assert!(std::fs::read_to_string(plist_path(&dir))
            .unwrap()
            .contains("/usr/local/bin/umuo"));

        set_enabled(&dir, exec, false).unwrap();
        assert!(!is_enabled(&dir));
    }

    #[test]
    fn disabling_something_already_off_is_not_an_error() {
        // 用户可能在设置里连点两次，或配置文件与磁盘状态不同步。
        let dir = home("idempotent");
        assert!(set_enabled(&dir, Path::new("/usr/local/bin/umuo"), false).is_ok());
    }

    #[test]
    fn the_path_is_where_macos_expects_it() {
        assert_eq!(
            plist_path(Path::new("/Users/someone")),
            PathBuf::from(format!("/Users/someone/Library/LaunchAgents/{LABEL}.plist"))
        );
    }
}
