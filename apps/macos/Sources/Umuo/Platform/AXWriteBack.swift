import ApplicationServices
import UmuoCore

/// 静默翻译的写回：检查目标可写性、来源和原文，防止修改错误的输入框。
///
/// 选区改 `AXSelectedText`，整框改 `AXValue`；写之前确认属性可写、原文还在原处。
/// **没有 ⌘V 兜底**：粘贴只会插在光标处，在不可写的地方还会打进 shell。写不进去就报错，
/// 流水线据此报 `WriteBackFailed`，浮窗不会假装替换成功。
///
/// 全是线程安全的 AX C API，直接在 Rust 的工作线程上调，不切主线程（§2.3）。
/// 拒绝理由是文案键，由宿主（`SwiftHost`）或浮窗按界面语言取成句子。
enum AXWriteBack {
    struct Refused: UserFacingError {
        let text: UserText
        init(_ key: String) { text = UserText(key) }
        init(_ text: UserText) { self.text = text }
    }

    /// 每种来源写回时改的 AX 属性。整框读的是 AXValue，写回也必须写 AXValue；写 AXSelectedText 会变成光标处插入。
    static func attribute(_ source: FocusSource) -> String {
        switch source {
        case .selection: "AXSelectedText"
        case .wholeField: "AXValue"
        }
    }

    /// 按「这个属性可不可写」决定能不能往里写：
    /// 明确不可写一律拒绝；问不出来时选区放行（Electron 一类常常问不出来却写得进去），整框拒绝。
    static func checkWritable(_ source: FocusSource, _ settable: Bool?) throws(Refused) {
        // 不用 (source, settable) 元组 switch：较旧的编译器（CI 上的 Xcode 16）证明不了它穷尽
        switch source {
        case .selection:
            if settable == false { throw Refused("error.selectionReadOnly") }
        case .wholeField:
            if settable != true { throw Refused("error.fieldNotReplaceable") }
        }
    }

    /// 写回前确认读到的东西还在原处：选区塌成光标、又打了字、读不到，都不写。
    static func checkUnchanged(_ source: FocusSource, _ current: String?, _ original: String) throws(Refused) {
        if current == original { return }
        switch source {
        case .selection: throw Refused("error.selectionChanged")
        case .wholeField: throw Refused("error.fieldChanged")
        }
    }

    /// `probe` 可注入：测试换成假的，不碰真实 AX。
    static func replace(_ source: FocusSource, original: String, text: String,
                        probe: FocusedTextProbing = AXTextProbe()) throws(Refused)
    {
        guard probe.trusted() else { throw Refused("error.accessibilityRequired") }
        // 写回时再查一次：同一应用里焦点可能已经换到别的控件，前台 pid 守卫拦不住。
        // 没有聚焦元素时落到「问不出来 / 读不到」：两道检查会给出对应的拒绝理由。
        let element = probe.focusedElement()
        if probe.secureInput(element) { throw Refused("error.secureInput") }
        let name = attribute(source)
        try checkWritable(source, element.flatMap { probe.isSettable($0, name) })
        try checkUnchanged(source, element.flatMap { probe.string($0, name) }, original)
        guard let element, probe.write(text, to: element, name) else {
            throw Refused("error.writeRejected")
        }
    }
}
