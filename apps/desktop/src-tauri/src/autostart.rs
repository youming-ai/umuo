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

fn unescape_xml(text: &str) -> String {
    // `&amp;` 最后还原：先还原它会把 `&amp;lt;` 错还原成 `<`。
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
}

/// 从 plist 里取出 `ProgramArguments` 的第一项（登录时要启动的程序）。
fn program_in_plist(plist: &str) -> Option<PathBuf> {
    let after_key = &plist[plist.find("<key>ProgramArguments</key>")?..];
    let start = after_key.find("<string>")? + "<string>".len();
    let end = start + after_key[start..].find("</string>")?;
    Some(PathBuf::from(unescape_xml(&after_key[start..end])))
}

/// 这个程序路径能不能写进 LaunchAgent。
///
/// 从 DMG 里直接打开（`/Volumes/...`）、或被 Gatekeeper 的 App Translocation 挪到随机只读
/// 目录里运行时，`current_exe()` 是一个**临时**路径：卸载 DMG 或重启之后就不在了，
/// 自启随之静默失效，开关却还显示「开」。这种情况直接拒绝，让用户先把应用装好。
pub fn check_launch_path(exec_path: &Path) -> Result<(), String> {
    let temporary = exec_path.starts_with("/Volumes")
        || exec_path
            .components()
            .any(|part| part.as_os_str() == "AppTranslocation");
    if temporary {
        return Err("umuo 正从临时位置运行（磁盘映像或系统隔离目录）。请先把它拖进「应用程序」文件夹、从那里打开，再开启开机启动".to_string());
    }
    Ok(())
}

/// plist 的落点：`<home>/Library/LaunchAgents/<label>.plist`。
pub fn plist_path(home: &Path) -> PathBuf {
    home.join("Library")
        .join("LaunchAgents")
        .join(format!("{LABEL}.plist"))
}

/// 现在是不是开着。判据是文件在、且里面写的程序还在——不查 `launchctl`，
/// 因为那是另一个进程的输出，会把"文件在但服务没加载"变成两种不一致的状态。
///
/// 程序不在了（应用被挪走、删掉，或当初写进去的是临时路径）时登录不会启动任何东西，
/// 如实报「关」，用户重新打开一次开关就会写入现在的路径。
pub fn is_enabled(home: &Path) -> bool {
    std::fs::read_to_string(plist_path(home))
        .ok()
        .and_then(|plist| program_in_plist(&plist))
        .is_some_and(|program| program.exists())
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
    check_launch_path(exec_path).map_err(io::Error::other)?;
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
        // 程序得真的存在，is_enabled 才认。
        let exec = dir.join("umuo");
        std::fs::write(&exec, "").unwrap();
        let exec = exec.as_path();

        assert!(!is_enabled(&dir), "初始应当是关的");
        set_enabled(&dir, exec, true).unwrap();
        assert!(is_enabled(&dir));
        assert!(std::fs::read_to_string(plist_path(&dir))
            .unwrap()
            .contains(&*exec.to_string_lossy()));

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
    fn the_program_path_round_trips_through_the_plist() {
        let exec = Path::new("/Users/a&b/My <App>/umuo");
        assert_eq!(
            program_in_plist(&launch_agent_plist(exec)).as_deref(),
            Some(exec)
        );
    }

    #[test]
    fn a_plist_pointing_at_a_missing_program_counts_as_off() {
        // 应用被挪走或删掉之后，登录时什么都不会启动——开关不该还显示「开」。
        let dir = home("stale");
        let path = plist_path(&dir);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, launch_agent_plist(&dir.join("gone/umuo"))).unwrap();
        assert!(!is_enabled(&dir));
    }

    #[test]
    fn temporary_locations_are_refused() {
        for exec in [
            "/Volumes/umuo/umuo.app/Contents/MacOS/umuo",
            "/private/var/folders/x/T/AppTranslocation/ABC/d/umuo.app/Contents/MacOS/umuo",
        ] {
            assert!(check_launch_path(Path::new(exec)).is_err(), "{exec}");
            let dir = home("translocated");
            assert!(set_enabled(&dir, Path::new(exec), true).is_err());
            assert!(!plist_path(&dir).exists(), "拒绝时不该留下文件");
        }
        assert!(check_launch_path(Path::new("/Applications/umuo.app/Contents/MacOS/umuo")).is_ok());
    }

    #[test]
    fn the_path_is_where_macos_expects_it() {
        assert_eq!(
            plist_path(Path::new("/Users/someone")),
            PathBuf::from(format!("/Users/someone/Library/LaunchAgents/{LABEL}.plist"))
        );
    }
}
