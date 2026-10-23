import ApplicationServices
import UmuoCore

/// 静默翻译的写回：检查目标可写性、来源和原文，防止修改错误的输入框。
///
/// 选区改 `AXSelectedText`，整框改 `AXValue`；写之前确认属性可写、原文还在原处。
/// **没有 ⌘V 兜底**：粘贴只会插在光标处，在不可写的地方还会打进 shell。写不进去就报错，
/// 流水线据此报 `WriteBackFailed`，浮窗不会假装替换成功。
///
/// 全是线程安全的 AX C API，直接在 Rust 的工作线程上调，不切主线程（§2.3）。
/// 错误文案与 Rust 版（`PlatformError` 的 Display）逐字一致，两个客户端的提示不分叉。
enum AXWriteBack {
    struct Refused: Error { let detail: String }

    /// 每种来源写回时改的 AX 属性。整框读的是 AXValue，写回也必须写 AXValue；写 AXSelectedText 会变成光标处插入。
    static func attribute(_ source: FocusSource) -> String {
        switch source {
        case .selection: "AXSelectedText"
        case .wholeField: "AXValue"
        }
    }

    /// 按「这个属性可不可写」决定能不能往里写（`check_writable`）：
    /// 明确不可写一律拒绝；问不出来时选区放行（Electron 一类常常问不出来却写得进去），整框拒绝。
    static func checkWritable(_ source: FocusSource, _ settable: Bool?) throws(Refused) {
        switch (source, settable) {
        case (_, true), (.selection, nil): return
        case (.selection, false): throw Refused(detail: "当前位置不可写入：选中的内容是只读的")
        case (.wholeField, _): throw Refused(detail: "当前位置不可写入：当前输入框不支持整体改写")
        }
    }

    /// 写回前确认读到的东西还在原处（`check_unchanged`）：选区塌成光标、又打了字、读不到，都不写。
    static func checkUnchanged(_ source: FocusSource, _ current: String?, _ original: String) throws(Refused) {
        if current == original { return }
        switch source {
        case .selection: throw Refused(detail: "选区在翻译期间变了，已放弃替换")
        case .wholeField: throw Refused(detail: "输入框内容在翻译期间变了，已放弃替换")
        }
    }

    static func replace(_ source: FocusSource, original: String, text: String) throws(Refused) {
        guard AXIsProcessTrusted() else { throw Refused(detail: "需要系统权限：辅助功能") }
        // 写回时再查一次：同一应用里焦点可能已经换到别的控件，前台 pid 守卫拦不住。
        // 没有聚焦元素时与 Rust 一样落到「问不出来 / 读不到」：两道检查会给出对应的拒绝理由。
        let element = AX.focusedElement()
        let name = attribute(source) as CFString
        try checkWritable(source, element.flatMap { AX.isSettable($0, name) })
        try checkUnchanged(source, element.flatMap { AX.string($0, name) }, original)
        guard let element, AXUIElementSetAttributeValue(element, name, text as CFString) == .success else {
            throw Refused(detail: "当前位置不可写入：应用拒绝了写入")
        }
    }
}
