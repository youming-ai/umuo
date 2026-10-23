import AppKit
import ApplicationServices
import UmuoCore

/// 静默翻译读到的文本连同它的来源：读的是整个输入框，写回就必须替换整个输入框（PRD §5.4）。
/// 来源复用 FFI 的 `FocusSource`，直接交给 `Engine.translate`。
struct FocusText: Equatable {
    let text: String
    let source: FocusSource
}

/// 取词失败。`description` 与 Rust 的 `PlatformError` Display 逐字一致，两个客户端的提示不分叉。
/// 黑名单不在这里查：那是 Rust 的 `Engine.selectionBlockNotice`，取词之前由调用方（`PanelTriggers`）问过。
enum SelectionError: Error, Equatable, CustomStringConvertible {
    /// 没有辅助功能权限。单独一个分支：UI 要据此把用户引到系统设置（PRD §7.4）。
    case permissionDenied
    case noSelection
    /// 可写性检查拒绝（文案来自 `AXWriteBack.checkWritable`，已带「当前位置不可写入：」前缀）。
    case notWritable(String)
    case other(String)

    var description: String {
        switch self {
        case .permissionDenied: "需要系统权限：辅助功能"
        case .noSelection: "没有检测到选中的文本"
        case let .notWritable(message), let .other(message): message
        }
    }
}

/// 从前台应用取词。
///
/// **都是同步阻塞的，不要在主线程调**：⌘C 降级最长要等约 1 秒（轮询 400ms + 迟到复制观察 600ms）。
/// AX 与 NSPasteboard 在工作线程上调都没问题。
enum Selection {
    /// 读取当前选中的文本：先走只读的 AX，拿不到（或只有空白）才降级到模拟 ⌘C。
    /// Electron / Java / 远程桌面里的 App 常常走降级。
    static func readSelection() throws(SelectionError) -> String {
        guard AXIsProcessTrusted() else { throw .permissionDenied }
        if let text = AX.focusedElement().flatMap({ AX.string($0, kAXSelectedTextAttribute as CFString) }),
           !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
            return text
        }
        return try ClipboardFallback().read()
    }

    /// 读取「该被翻译的文本」：优先选区，没有选区时读整个可编辑区域（PRD §5.4）。
    ///
    /// **不做剪贴板降级**：静默翻译紧接着要经同一条 AX 通道写回，这条通道不通的话，
    /// 降级取词也救不回来，只会白白动一次用户的剪贴板。
    static func readFocusText() throws(SelectionError) -> FocusText {
        guard AXIsProcessTrusted() else { throw .permissionDenied }
        let element = AX.focusedElement()

        // 选中了什么就翻什么。写不回去的话先说清楚，免得白翻一遍。
        if let text = element.flatMap({ AX.string($0, kAXSelectedTextAttribute as CFString) }),
           !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
            try checkWritable(.selection, element)
            return FocusText(text: text, source: .selection)
        }

        // 没选中就是「把整个输入框翻一遍」。**先确认整框可写再读**：终端的 AXValue 是整段滚动缓冲区，
        // 读了也写不回去，还会把它整段发给供应商。
        try checkWritable(.wholeField, element)
        guard let text = element.flatMap({ AX.string($0, kAXValueAttribute as CFString) }),
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { throw .noSelection }
        return FocusText(text: text, source: .wholeField)
    }

    /// 向前台应用发送一次「粘贴」（合成 ⌘V）。调用方负责先写剪贴板——这里只负责按键。
    /// 与 Rust 的 `paste_clipboard` 一样不查权限、不拿剪贴板锁。
    static func pasteClipboard() throws(SelectionError) { try KeyEvent.paste() }

    private static func checkWritable(_ source: FocusSource, _ element: AXUIElement?) throws(SelectionError) {
        let name = AXWriteBack.attribute(source) as CFString
        do { try AXWriteBack.checkWritable(source, element.flatMap { AX.isSettable($0, name) }) } catch {
            throw .notWritable(error.detail)
        }
    }
}

/// 模拟 ⌘C 取词：AX 拿不到选区时的兜底。这是**唯一**会借用用户剪贴板的地方，
/// 所以整段逻辑都围绕「怎么把剪贴板原样还回去」与「怎么不误判」展开：
///
/// - 整个事务拿着 `Pasteboard.exclusive`，连按两次不会互相踩。
/// - 快照存的是所有 item 的所有类型，图片、文件、富文本都原样还回去。
/// - 合成 ⌘C 失败也先恢复再报错。
/// - 超时后再盯一会儿，迟到的复制结果盖上来就再恢复一次。
///
/// 剪贴板与「按 ⌘C」都可注入：正式路径是 `.general` + `KeyEvent.copy`，selftest 换成私有剪贴板与假的复制动作。
struct ClipboardFallback {
    /// 轮询节奏：20ms × 20 次 ≈ 400ms 上限。再长会让用户觉得「快捷键按下去没反应」，再短则可能在慢 App 里读空。
    static let pollInterval: TimeInterval = 0.02
    static let pollAttempts = 20
    /// 超时之后再盯多久：卡顿的应用（Slack、远程桌面）可能在我们恢复剪贴板之后才处理那次 ⌘C，
    /// 把选中文本盖到刚还回去的内容上。
    static let lateCopyWindow: TimeInterval = 0.6
    static let lateCopyPollInterval: TimeInterval = 0.05

    var pasteboard: NSPasteboard = .general
    var copy: () throws(SelectionError) -> Void = { () throws(SelectionError) in try KeyEvent.copy() }

    func read() throws(SelectionError) -> String {
        Pasteboard.exclusive.lock()
        defer { Pasteboard.exclusive.unlock() }
        let snapshot = Pasteboard.Snapshot.take(pasteboard)

        // 先清空再复制。否则当剪贴板内容恰好等于选中内容时，
        // 无法区分「复制成功了」和「复制根本没生效，读到的还是旧内容」。
        let cleared = pasteboard.clearContents()
        let captured = Result { () throws(SelectionError) in
            try copy()
            return pollCopied(cleared)
        }

        // 把用户的剪贴板还回去（PRD §5.2）。在传播任何错误之前做。
        snapshot.restore(pasteboard)

        if let text = try captured.get() { return text }
        guardAgainstLateCopy(snapshot)
        throw .noSelection
    }

    /// 判断「这次复制成功了没有」。看修改计数而不是只看内容：清空之后计数变了，
    /// 才说明有人（目标应用）写过剪贴板。计数变了但不是文本（复制了图片）或是空串，都不算取到。
    static func copiedText(cleared: Int, now: Int, text: String?) -> String? {
        guard now != cleared, let text, !text.isEmpty else { return nil }
        return text
    }

    /// 轮询剪贴板，等目标应用写入这次复制的结果。先睡再看：⌘C 刚发出去时还不可能有结果。
    private func pollCopied(_ cleared: Int) -> String? {
        for _ in 0 ..< Self.pollAttempts {
            Thread.sleep(forTimeInterval: Self.pollInterval)
            if let text = Self.copiedText(cleared: cleared, now: pasteboard.changeCount,
                                          text: Pasteboard.string(pasteboard))
            {
                return text
            }
        }
        return nil
    }

    /// 超时之后，那次 ⌘C 仍可能被慢应用处理：剪贴板在观察窗口内被改了，就再恢复一次。
    ///
    /// 仍在独占权里做，代价是取词失败时多等一会儿才报「没有检测到选中的文本」；
    /// 换来的是用户的剪贴板不会在提示出现之后才被悄悄换掉。基准计数取在恢复之后。
    private func guardAgainstLateCopy(_ snapshot: Pasteboard.Snapshot) {
        let restored = pasteboard.changeCount
        var waited: TimeInterval = 0
        while waited < Self.lateCopyWindow {
            Thread.sleep(forTimeInterval: Self.lateCopyPollInterval)
            waited += Self.lateCopyPollInterval
            if pasteboard.changeCount != restored {
                snapshot.restore(pasteboard)
                return
            }
        }
    }
}
