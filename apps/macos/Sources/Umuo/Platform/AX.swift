import ApplicationServices
import Carbon

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

    /// 安全输入：聚焦的是密码框（角色或子角色），或有应用开启了安全键盘输入（`IsSecureEventInputEnabled`）。
    /// 取词、静默写回、浮窗替换与语音交付共用这一处判断：密码框里的内容不读、不发给供应商，也不往里写。
    /// 浏览器把密码框的 `AXValue` 暴露成掩码，整框翻译会把掩码发出去，再把译文写回覆盖密码。
    static func isSecureInput(_ element: AXUIElement?) -> Bool {
        if IsSecureEventInputEnabled() { return true }
        guard let element else { return false }
        return string(element, kAXRoleAttribute as CFString) == "AXSecureTextField"
            || string(element, kAXSubroleAttribute as CFString) == (kAXSecureTextFieldSubrole as String)
    }
}

/// 写回守卫眼里「此刻聚焦的文本目标」：权限、聚焦元素、属性的可写性与内容、写入。
/// 浮窗「替换原文」（`ReplaceSelection`）与静默翻译写回（`AXWriteBack`）共用；正式实现 `AXTextProbe`，
/// 测试换成假的（不碰真实 AX）。都在工作线程上调，不切主线程。
protocol FocusedTextProbing: Sendable {
    /// 有辅助功能权限。
    func trusted() -> Bool
    /// 现查聚焦元素；之后的读写都对着这一个，不再重新取焦点。
    func focusedElement() -> AXUIElement?
    /// nil = 问不出来（见 `AX.isSettable`）。
    func isSettable(_ element: AXUIElement, _ attribute: String) -> Bool?
    func string(_ element: AXUIElement, _ attribute: String) -> String?
    /// 密码框或安全输入（见 `AX.isSecureInput`）：是的话一律不写。
    func secureInput(_ element: AXUIElement?) -> Bool
    /// 写入属性。返回是否成功。
    func write(_ text: String, to element: AXUIElement, _ attribute: String) -> Bool
}

/// 正式实现：线程安全的 AX C API。
struct AXTextProbe: FocusedTextProbing {
    func trusted() -> Bool { AXIsProcessTrusted() }
    func focusedElement() -> AXUIElement? { AX.focusedElement() }
    func isSettable(_ element: AXUIElement, _ attribute: String) -> Bool? {
        AX.isSettable(element, attribute as CFString)
    }

    func string(_ element: AXUIElement, _ attribute: String) -> String? { AX.string(element, attribute as CFString) }
    func secureInput(_ element: AXUIElement?) -> Bool { AX.isSecureInput(element) }
    func write(_ text: String, to element: AXUIElement, _ attribute: String) -> Bool {
        AXUIElementSetAttributeValue(element, attribute as CFString, text as CFString) == .success
    }
}
