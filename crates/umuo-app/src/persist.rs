//! 小 JSON 文件（`settings.json` / `glossaries.json`）的读写。
//! 旧的 `stats.json` 当前版本不再读写，原文件留在配置目录里不动。
//!
//! 两个文件共用这一处，口径只有一份：
//! - **写**：先写同目录的临时文件、`sync_all`，再 `rename` 覆盖。`rename` 在同一个卷上是原子的，
//!   断电或内核崩溃后看到的要么是旧文件、要么是新文件，不会是半截。
//! - **读**：只有「文件不存在」才静默回落默认值。读不动（编码不对、权限）或解析不了，
//!   都先把原文件挪成 `<文件名>.corrupt-<时间戳>` 再回落——否则回落后的第一次保存会把它覆盖掉，
//!   用户连找回的机会都没有。备份名带时间戳，第二次损坏不会盖掉第一次的备份
//!   （与 `history.db.corrupt-<时间戳>` 同一约定）。
//! - 设置另走 [`load_object_or_backup`]：只有不是合法 JSON 或顶层不是对象才整份备份，
//!   能解析成对象时由 `Settings::load` 做字段级容错（见那里的说明）。

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;

/// 原子写：临时文件 + `sync_all` + `rename`。
///
/// 临时文件名是固定的 `<文件名>.tmp`：设置只在设置锁里写；术语表只在导入配置时写，
/// 而导入同样在设置锁里（见 `AppCore::apply_settings_patch_with`），不会有两个写入方同时用这个名字。
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = with_suffix(path, ".tmp");
    let result = (|| {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        // 写到一半失败时别把临时文件留在配置目录里。
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// 读 `dir/file` 里的 JSON。不存在 → 默认值；读不动或解析不了 → 备份后回落默认值。
pub fn load_or_backup<T: DeserializeOwned + Default>(dir: &Path, file: &str) -> T {
    let path = dir.join(file);
    // 读字节而不是 `read_to_string`：非 UTF-8（比如被另存成 GBK）在这里不算读取失败，
    // 而是走下面的解析失败分支，同样会被备份。
    let raw = match fs::read(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return T::default(),
        Err(_) => {
            backup_aside(&path);
            return T::default();
        }
    };
    match serde_json::from_slice(&raw) {
        Ok(value) => value,
        Err(_) => {
            backup_aside(&path);
            T::default()
        }
    }
}

/// 读 `dir/file` 里的 JSON **对象**，不反序列化成具体类型，留给调用方做字段级容错。
///
/// 不存在 → `None`，不备份；读不动、不是合法 JSON、顶层不是对象 → 备份后 `None`。
pub fn load_object_or_backup(
    dir: &Path,
    file: &str,
) -> Option<serde_json::Map<String, serde_json::Value>> {
    let path = dir.join(file);
    let raw = match fs::read(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return None,
        Err(_) => {
            backup_aside(&path);
            return None;
        }
    };
    match serde_json::from_slice(&raw) {
        Ok(serde_json::Value::Object(fields)) => Some(fields),
        _ => {
            backup_aside(&path);
            None
        }
    }
}

/// 把原文件**复制**一份到 `<文件名>.corrupt-<时间戳>`，原文件留在原处。
///
/// 字段级回落用：文件整体还能用，只是有字段被丢弃，用户手改的原文要能找回。
pub fn copy_aside(path: &Path) -> io::Result<()> {
    fs::copy(path, with_suffix(path, &format!(".corrupt-{}", stamp()))).map(|_| ())
}

/// 把坏文件挪到 `<文件名>.corrupt-<时间戳>`。挪不动也不拦启动。
fn backup_aside(path: &Path) {
    let _ = fs::rename(path, with_suffix(path, &format!(".corrupt-{}", stamp())));
}

fn stamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default()
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

/// 目录里以 `<file>.corrupt-` 开头的备份（测试与排查用）。
#[cfg(test)]
pub fn corrupt_backups(dir: &Path, file: &str) -> Vec<PathBuf> {
    let prefix = format!("{file}.corrupt-");
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| name.starts_with(&prefix))
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Default, PartialEq, serde::Deserialize)]
    struct Sample {
        value: u32,
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("umuo-persist-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn an_atomic_write_replaces_the_file_and_leaves_no_temp_behind() {
        let dir = temp_dir("atomic");
        let path = dir.join("a.json");
        fs::write(&path, "old").unwrap();
        write_atomic(&path, br#"{"value":7}"#).unwrap();
        assert_eq!(
            load_or_backup::<Sample>(&dir, "a.json"),
            Sample { value: 7 }
        );
        assert!(!dir.join("a.json.tmp").exists(), "临时文件应已被 rename 掉");
    }

    #[test]
    fn a_missing_file_is_defaults_and_creates_no_backup() {
        let dir = temp_dir("missing");
        assert_eq!(load_or_backup::<Sample>(&dir, "a.json"), Sample::default());
        assert!(corrupt_backups(&dir, "a.json").is_empty());
    }

    #[test]
    fn a_non_utf8_file_is_backed_up_instead_of_silently_treated_as_absent() {
        // 被另存成 GBK 之类的编码：不是「没有文件」，原文件必须留一份。
        let dir = temp_dir("non-utf8");
        fs::write(dir.join("a.json"), b"\xff\xfe{").unwrap();
        assert_eq!(load_or_backup::<Sample>(&dir, "a.json"), Sample::default());
        assert!(!dir.join("a.json").exists());
        assert_eq!(corrupt_backups(&dir, "a.json").len(), 1);
    }

    #[test]
    fn a_second_corruption_does_not_overwrite_the_first_backup() {
        let dir = temp_dir("twice");
        fs::write(dir.join("a.json"), "{ 坏的").unwrap();
        let _ = load_or_backup::<Sample>(&dir, "a.json");
        std::thread::sleep(std::time::Duration::from_millis(5));
        fs::write(dir.join("a.json"), "{ 又坏了").unwrap();
        let _ = load_or_backup::<Sample>(&dir, "a.json");
        assert_eq!(corrupt_backups(&dir, "a.json").len(), 2);
    }
}
