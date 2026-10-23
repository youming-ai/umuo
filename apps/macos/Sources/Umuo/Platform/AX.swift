import ApplicationServices

/// Accessibility 的最小封装，取词（`Selection`）与写回（`AXWriteBack`）共用。
/// 封装 macOS Accessibility：全是线程安全的 C API，工作线程上直接调。
enum AX {
    /// 当前聚焦的 UI 元素（系统级 `AXFocusedUIElement`）。没有权限、没有焦点时为 nil。
    static func focusedElement() -> AXUIElement? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(AXUIElementCreateSystemWide(),
                                            kAXFocusedUIElementAttribute as CFString, &value) == .success,
              let value, CFGetTypeID(value) == AXUIElementGetTypeID()
        else { return nil }
        return (value as! AXUIElement)
    }

    /// nil = 问不出来（该 App 不支持这个属性），与「明确不可写」不同：Electron 一类常常问不出来却写得进去。
    static func isSettable(_ element: AXUIElement, _ name: CFString) -> Bool? {
        var settable: DarwinBoolean = false
        return AXUIElementIsAttributeSettable(element, name, &settable) == .success ? settable.boolValue : nil
    }

    /// 先验类型：多选场景下属性可能回数组或数字，当字符串解会出错而不是干脆失败。
    static func string(_ element: AXUIElement, _ name: CFString) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name, &value) == .success,
              let value, CFGetTypeID(value) == CFStringGetTypeID()
        else { return nil }
        return (value as! CFString) as String
    }
}
