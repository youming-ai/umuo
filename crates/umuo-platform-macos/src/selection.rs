//! 取词与写回。

use std::time::Duration;

use umuo_platform::{FocusSource, FocusText, PlatformError, SelectionReader};

use crate::ax;
use crate::clipboard::{self, Snapshot};
use crate::key_event;

/// 降级路径轮询剪贴板的节奏。20ms × 20 次 ≈ 400ms 上限：
/// 再长会让用户觉得「快捷键按下去没反应」，再短则可能在慢 App 里读空。
const CLIPBOARD_POLL_INTERVAL: Duration = Duration::from_millis(20);
const CLIPBOARD_POLL_ATTEMPTS: u32 = 20;

/// 超时之后再盯多久：卡顿的应用（Slack、远程桌面）可能在我们恢复剪贴板之后
/// 才处理那次 ⌘C，把选中文本盖到刚还回去的内容上。
const LATE_COPY_WINDOW: Duration = Duration::from_millis(600);
const LATE_COPY_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// 降级所需权限的展示名，用于把用户引到正确的系统设置面板。
const ACCESSIBILITY: &str = "辅助功能";

/// 轮询时判断「这次复制成功了没有」。看修改计数而不是只看内容：
/// 清空之后计数变了，才说明有人（目标应用）写过剪贴板。抽成纯函数是为了能测。
fn copied_text(cleared: isize, now: isize, text: Option<String>) -> Option<String> {
    if now == cleared {
        return None;
    }
    text.filter(|text| !text.is_empty())
}

/// 每种来源写回时改的 AX 属性：选区改 `AXSelectedText`，整框改 `AXValue`。
fn write_attribute(source: FocusSource) -> &'static str {
    match source {
        FocusSource::Selection => "AXSelectedText",
        FocusSource::WholeField => "AXValue",
    }
}

/// 按「这个属性可不可写」决定能不能往里写。抽成纯函数是为了能测。
///
/// - **明确不可写**（终端缓冲区、只读文本）：一律拒绝。
/// - **问不出来**：选区放行，交给真正的写入去试——Electron 一类 App 常常问不出来，
///   却写得进去；整框拒绝——整框读写只靠 `AXValue`，问不出来就说明这条路不通，
///   不该为一段写不回去的文本把整个区域发给供应商。
fn check_writable(source: FocusSource, settable: Option<bool>) -> Result<(), PlatformError> {
    match (source, settable) {
        (_, Some(true)) | (FocusSource::Selection, None) => Ok(()),
        (FocusSource::Selection, Some(false)) => Err(PlatformError::NotWritable {
            detail: "选中的内容是只读的",
        }),
        (FocusSource::WholeField, _) => Err(PlatformError::NotWritable {
            detail: "当前输入框不支持整体改写",
        }),
    }
}

/// 写回前确认读到的东西还在原处：翻译要花几秒，用户可能在这期间点了一下输入框
/// （选区塌成光标，再写 `AXSelectedText` 就成了光标处插入）或者又打了字。
/// `current` 是写回前重新读到的选区 / 整框内容。抽成纯函数是为了能测。
fn check_unchanged(
    source: FocusSource,
    current: Option<&str>,
    original: &str,
) -> Result<(), PlatformError> {
    if current == Some(original) {
        return Ok(());
    }
    let message = match source {
        FocusSource::Selection => "选区在翻译期间变了，已放弃替换",
        FocusSource::WholeField => "输入框内容在翻译期间变了，已放弃替换",
    };
    Err(PlatformError::Other(message.into()))
}

/// 浮窗「替换原文」能不能往下走（含 ⌘V 兜底）。
///
/// 只有聚焦元素**确实是个能读选区的文本控件**、且 AX 明确说选区不可写（终端、只读文本），
/// 才拒绝——这时 ⌘V 会把译文打进 shell。读不出选区的元素（Electron / 网页视图里的
/// group、window）对任何属性都会答「不可写」，那个回答不算数：这些 App 的原文本来就是
/// 靠模拟复制取的，⌘V 是唯一写得回去的路。
fn check_panel_writable(
    settable: Option<bool>,
    selection_readable: bool,
) -> Result<(), PlatformError> {
    if selection_readable {
        check_writable(FocusSource::Selection, settable)
    } else {
        Ok(())
    }
}

pub struct MacSelection;

impl MacSelection {
    /// 模拟 ⌘C 取词：AX 拿不到选区时的兜底。
    ///
    /// 这是**唯一**会借用用户剪贴板的地方，所以整段逻辑都围绕「怎么把剪贴板原样还回去」
    /// 与「怎么不误判」展开：
    ///
    /// - 整个事务拿着剪贴板的独占权（[`clipboard::exclusive`]），连按两次不会互相踩。
    /// - 快照存的是所有 item 的所有类型，图片、文件、富文本都原样还回去。
    /// - 合成 ⌘C 失败也先恢复再报错。
    /// - 超时后再盯一会儿，迟到的复制结果盖上来就再恢复一次。
    fn read_via_clipboard(&self) -> Result<String, PlatformError> {
        let _exclusive = clipboard::exclusive();
        let snapshot = Snapshot::take();

        // 先清空再复制。否则当剪贴板内容恰好等于选中内容时，
        // 我们无法区分「复制成功了」和「复制根本没生效，读到的还是旧内容」。
        let cleared = clipboard::clear();
        let captured = key_event::copy().map(|()| poll_copied(cleared));

        // 把用户的剪贴板还回去（PRD §5.2）。在传播任何错误之前做。
        snapshot.restore();

        match captured? {
            Some(text) => Ok(text),
            None => {
                guard_against_late_copy(&snapshot);
                Err(PlatformError::NoSelection)
            }
        }
    }
}

/// 轮询剪贴板，等目标应用写入这次复制的结果。
fn poll_copied(cleared: isize) -> Option<String> {
    for _ in 0..CLIPBOARD_POLL_ATTEMPTS {
        std::thread::sleep(CLIPBOARD_POLL_INTERVAL);
        if let Some(text) =
            copied_text(cleared, clipboard::change_count(), clipboard::read_string())
        {
            return Some(text);
        }
    }
    None
}

/// 超时之后，那次 ⌘C 仍可能被慢应用处理：剪贴板在观察窗口内被改了，就再恢复一次。
///
/// 仍在独占权里做，代价是取词失败时多等一会儿才报「没有检测到选中的文本」；
/// 换来的是用户的剪贴板不会在提示出现之后才被悄悄换掉。
fn guard_against_late_copy(snapshot: &Snapshot) {
    let restored = clipboard::change_count();
    let mut waited = Duration::ZERO;
    while waited < LATE_COPY_WINDOW {
        std::thread::sleep(LATE_COPY_POLL_INTERVAL);
        waited += LATE_COPY_POLL_INTERVAL;
        if clipboard::change_count() != restored {
            snapshot.restore();
            return;
        }
    }
}

impl SelectionReader for MacSelection {
    fn read_selection(&self) -> Result<String, PlatformError> {
        if !ax::is_trusted() {
            return Err(PlatformError::PermissionDenied {
                capability: ACCESSIBILITY,
            });
        }

        // 首选：Accessibility，只读、不产生任何副作用。
        if let Some(text) = ax::selected_text() {
            if !text.trim().is_empty() {
                return Ok(text);
            }
        }

        // 兜底：模拟复制。Electron / Java / 远程桌面里的 App 常常走这条。
        self.read_via_clipboard()
    }

    fn read_focus_text(&self) -> Result<FocusText, PlatformError> {
        if !ax::is_trusted() {
            return Err(PlatformError::PermissionDenied {
                capability: ACCESSIBILITY,
            });
        }

        // 选中了什么就翻什么。写不回去的话先说清楚，免得白翻一遍。
        if let Some(text) = ax::selected_text() {
            if !text.trim().is_empty() {
                let source = FocusSource::Selection;
                check_writable(source, ax::is_settable(write_attribute(source)))?;
                return Ok(FocusText { text, source });
            }
        }

        // 没选中就是「把整个输入框翻一遍」——用户按 ⌥⇧T 时常常什么都不选。
        // 先确认整框可写再读：终端的 AXValue 是整段滚动缓冲区，读了也写不回去，
        // 还会把它整段发给供应商。
        let source = FocusSource::WholeField;
        check_writable(source, ax::is_settable(write_attribute(source)))?;
        match ax::focused_value() {
            Some(text) if !text.trim().is_empty() => Ok(FocusText { text, source }),
            _ => Err(PlatformError::NoSelection),
        }
    }

    fn replace_focus_text(
        &self,
        source: FocusSource,
        original: &str,
        text: &str,
    ) -> Result<(), PlatformError> {
        if !ax::is_trusted() {
            return Err(PlatformError::PermissionDenied {
                capability: ACCESSIBILITY,
            });
        }

        // 写回时再查一次：同一应用里焦点可能已经换到别的控件，前台 pid 守卫拦不住。
        check_writable(source, ax::is_settable(write_attribute(source)))?;

        let written = match source {
            FocusSource::Selection => {
                // 选区塌成光标时写 AXSelectedText 是插入，原文还在，正是 H4 的症状。
                check_unchanged(source, ax::selected_text().as_deref(), original)?;
                ax::set_selected_text(text)
            }
            FocusSource::WholeField => {
                // 翻译期间用户又改了输入框的话，整框覆盖会吃掉他新打的字。
                check_unchanged(source, ax::focused_value().as_deref(), original)?;
                ax::set_focused_value(text)
            }
        };
        // 不走 ⌘V 兜底：粘贴只会插在光标处，在不可写的地方还会打进 shell。
        if written {
            Ok(())
        } else {
            Err(PlatformError::NotWritable {
                detail: "应用拒绝了写入",
            })
        }
    }

    fn replace_selection(&self, text: &str) -> Result<(), PlatformError> {
        if !ax::is_trusted() {
            return Err(PlatformError::PermissionDenied {
                capability: ACCESSIBILITY,
            });
        }

        // 文本控件明确不可写（终端、只读文本）就到此为止：下面的 ⌘V 兜底在终端里会把译文打进 shell。
        check_panel_writable(
            ax::is_settable(write_attribute(FocusSource::Selection)),
            ax::selected_text().is_some(),
        )?;

        // 首选仍是 AX：直接改写选区，不碰剪贴板。
        if ax::set_selected_text(text) {
            return Ok(());
        }

        // 兜底：写剪贴板 + ⌘V。只留给 AX 通道不通的 App（Electron 等）——
        // 浮窗的原文本来就可能是靠模拟复制取到的，AX 通道在那里本来就不通。
        // 这条路会把剪贴板内容换成译文，这里不做恢复——恢复了反而会让紧接着的粘贴拿到旧内容。
        // 写入与粘贴之间不能插进一次取词降级，否则粘出去的是它清空或恢复后的内容。
        let _exclusive = clipboard::exclusive();
        clipboard::set_text(text)?;
        key_event::paste()
    }

    fn frontmost_app_token(&self) -> Option<String> {
        // 用 pid 当标识：只需要「同一焦点前后两次相等」，不需要跨进程稳定。
        ax::frontmost_pid().map(|pid| pid.to_string())
    }

    fn activate_app(&self, token: &str) -> bool {
        token.parse().is_ok_and(ax::activate_pid)
    }

    fn frontmost_app_name(&self) -> Option<String> {
        ax::frontmost_app_name()
    }

    fn paste_clipboard(&self) -> Result<(), PlatformError> {
        key_event::paste()
    }

    fn is_trusted(&self) -> bool {
        ax::is_trusted()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_is_written_unless_explicitly_read_only() {
        assert!(check_writable(FocusSource::Selection, Some(true)).is_ok());
        // 问不出来时交给真正的写入去试（Electron 等）。
        assert!(check_writable(FocusSource::Selection, None).is_ok());
        assert!(matches!(
            check_writable(FocusSource::Selection, Some(false)),
            Err(PlatformError::NotWritable { .. })
        ));
    }

    #[test]
    fn whole_field_needs_a_confirmed_writable_value() {
        assert!(check_writable(FocusSource::WholeField, Some(true)).is_ok());
        for settable in [None, Some(false)] {
            assert!(matches!(
                check_writable(FocusSource::WholeField, settable),
                Err(PlatformError::NotWritable { .. })
            ));
        }
    }

    #[test]
    fn write_back_requires_the_original_to_still_be_there() {
        for source in [FocusSource::Selection, FocusSource::WholeField] {
            assert!(check_unchanged(source, Some("hello"), "hello").is_ok());
            // 选区塌成光标（空串）、内容改了、读不到，都不能写。
            for current in [Some(""), Some("hello world"), None] {
                assert!(matches!(
                    check_unchanged(source, current, "hello"),
                    Err(PlatformError::Other(_))
                ));
            }
        }
    }

    #[test]
    fn panel_refuses_only_read_only_text_controls() {
        // 终端 / 只读文本：能读选区，明确不可写 → 拒绝，免得 ⌘V 打进 shell。
        assert!(matches!(
            check_panel_writable(Some(false), true),
            Err(PlatformError::NotWritable { .. })
        ));
        assert!(check_panel_writable(Some(true), true).is_ok());
        assert!(check_panel_writable(None, true).is_ok());
        // Electron 等：读不出选区，它答的「不可写」不算数，留给 ⌘V 兜底。
        for settable in [Some(false), Some(true), None] {
            assert!(check_panel_writable(settable, false).is_ok());
        }
    }

    #[test]
    fn a_copy_counts_only_after_someone_wrote_the_clipboard() {
        // 计数没变：剪贴板还是我们清空后的样子，读到什么都不算。
        assert_eq!(copied_text(5, 5, Some("旧内容".into())), None);
        assert_eq!(copied_text(5, 6, Some("选中".into())), Some("选中".into()));
        // 计数变了但不是文本（复制了图片）或是空串：不算取到。
        assert_eq!(copied_text(5, 6, None), None);
        assert_eq!(copied_text(5, 6, Some(String::new())), None);
    }

    #[test]
    fn each_source_writes_its_own_attribute() {
        // 整框读的是 AXValue，写回也必须写 AXValue；写 AXSelectedText 会变成光标处插入。
        assert_eq!(write_attribute(FocusSource::Selection), "AXSelectedText");
        assert_eq!(write_attribute(FocusSource::WholeField), "AXValue");
    }

    #[test]
    #[ignore = "需要真实的辅助功能权限与前台选区，手动运行：cargo test -p umuo-platform-macos -- --ignored"]
    fn reading_a_real_selection_returns_text() {
        let selection = MacSelection;
        assert!(
            selection.is_trusted(),
            "运行前请先给终端/应用开启辅助功能权限"
        );
        assert!(!selection.read_selection().unwrap().trim().is_empty());
    }

    #[test]
    #[ignore = "需要有焦点输入框，手动运行：cargo test -p umuo-platform-macos -- --ignored"]
    fn permission_state_is_reported_consistently() {
        // 这条断言的价值在于暴露「权限没开」这类环境问题，而不是业务逻辑。
        assert_eq!(MacSelection.is_trusted(), ax::is_trusted());
    }
}
