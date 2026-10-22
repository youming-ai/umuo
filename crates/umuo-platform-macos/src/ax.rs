//! Accessibility API 的最小 FFI 封装。
//!
//! 不引第三方 accessibility crate 的原因：我们只需要四个函数与几个属性名，
//! 而这类 crate 的 API 与维护状态都不够稳定；手写 FFI 只有几十行，
//! 且 AX 的 C API 十几年来没有变过。
//!
//! 属性名直接用字符串字面量。`kAXSelectedTextAttribute` 这类常量本身就是
//! `"AXSelectedText"` 这样的 CFString，所以不需要去 extern 那些静态符号——
//! 它们的链接方式在不同 SDK 下并不一致，用字符串更省事也更稳。

use std::ffi::c_void;

use core_foundation::base::TCFType;
use core_foundation::boolean::CFBoolean;
use core_foundation::string::{CFString, CFStringRef};

/// Accessibility 元素句柄。
pub type AXUIElementRef = *const c_void;

const AX_ERROR_SUCCESS: i32 = 0;
/// 用 `kAXErrorAPIDisabled` 判断「权限没开」比只看 `AXIsProcessTrusted` 更贴近现场。
pub const AX_ERROR_API_DISABLED: i32 = -25211;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut *const c_void,
    ) -> i32;
    fn AXUIElementSetAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *const c_void,
    ) -> i32;
    fn AXUIElementIsAttributeSettable(
        element: AXUIElementRef,
        attribute: CFStringRef,
        settable: *mut u8,
    ) -> i32;
    fn AXIsProcessTrusted() -> bool;
    fn AXUIElementGetPid(element: AXUIElementRef, pid: *mut i32) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
    fn CFGetTypeID(cf: *const c_void) -> usize;
    fn CFStringGetTypeID() -> usize;
}

/// 当前进程是否已获得辅助功能权限。
pub fn is_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// 读一个属性。成功时返回值带 +1 引用计数，调用方负责释放。
fn copy_attribute(element: AXUIElementRef, attribute: &str) -> Option<*const c_void> {
    let key = CFString::new(attribute);
    let mut value: *const c_void = std::ptr::null();
    let error =
        unsafe { AXUIElementCopyAttributeValue(element, key.as_concrete_TypeRef(), &mut value) };
    if error == AX_ERROR_SUCCESS && !value.is_null() {
        Some(value)
    } else {
        None
    }
}

/// 释放一个 +1 的 CF 对象。
///
/// # Safety
/// `ptr` 必须是按 create/copy 规则拿到的、且尚未释放的对象。
unsafe fn release(ptr: *const c_void) {
    CFRelease(ptr);
}

/// 系统级元素（当前聚焦的 UI 元素挂在它下面）。
fn system_wide() -> Option<AXUIElementRef> {
    let element = unsafe { AXUIElementCreateSystemWide() };
    if element.is_null() {
        None
    } else {
        Some(element)
    }
}

/// 当前聚焦的 UI 元素。
pub fn focused_element() -> Option<AXUIElementRef> {
    let system = system_wide()?;
    let focused = copy_attribute(system, "AXFocusedUIElement");
    // system-wide 元素是 create 规则来的，无论成败都要释放。
    unsafe { release(system) };
    focused
}

/// 读取当前选中的文本。拿不到时返回 `None`（不报错——调用方要据此走降级路径）。
///
/// 返回 `Err(true)` 形状的语义我们不采用：这里只有「拿到」与「没拿到」两种结果，
/// 具体原因（没权限 / 没有选区 / 该 App 不支持）由调用方结合 [`is_trusted`] 判断。
pub fn selected_text() -> Option<String> {
    let element = focused_element()?;
    let value = copy_attribute(element, "AXSelectedText");
    unsafe { release(element) };
    let value = value?;
    unsafe { cf_string_to_string(value) }
}

/// 当前前台应用的显示名（`AXTitle`）。
///
/// 历史记录要写「这条是哪个应用里译的」。拿不到时返回 `None`——
/// **存一个假名字比空着更糟**：用户会以为工具认错了应用。
pub fn frontmost_app_name() -> Option<String> {
    let system = system_wide()?;
    let application = copy_attribute(system, "AXFocusedApplication");
    unsafe { release(system) };
    let application = application?;

    let title = copy_attribute(application, "AXTitle");
    unsafe { release(application) };
    let title = title?;
    unsafe { cf_string_to_string(title) }
}

/// 读取聚焦元素的「值」——输入框、文本域里的整段文本（PRD §5.4 的「无选中则读整个输入框」）。
///
/// 不可编辑的控件也可能有 `AXValue`（例如滑块是数字、复选框是 0/1），
/// 所以调用方不能只靠这里判断「用户是不是在输入框里」；不过对静默翻译来说，
/// 拿到一段能翻译的文本就够了——拿到的是一串数字时翻译结果也就等于原文。
pub fn focused_value() -> Option<String> {
    let element = focused_element()?;
    let value = copy_attribute(element, "AXValue");
    unsafe { release(element) };
    let value = value?;
    unsafe { cf_string_to_string(value) }
}

/// 当前前台应用的进程号。
///
/// 用途是**写回前的守卫**：静默翻译要花几秒，用户可能已经切到别的窗口，
/// 这时把译文写回去就会打进另一个应用里。对比前后两次的 pid 就能拦住这种情况。
///
/// 只比 pid 而不比具体控件，是权衡后的选择：同应用内切换输入框也会造成误写，
/// 但那只是「替换到了同一应用的另一个框」，而跨应用误写是另一种性质的事故。
pub fn frontmost_pid() -> Option<i32> {
    let system = system_wide()?;
    let application = copy_attribute(system, "AXFocusedApplication");
    unsafe { release(system) };
    let application = application?;

    let mut pid: i32 = 0;
    let error = unsafe { AXUIElementGetPid(application, &mut pid) };
    unsafe { release(application) };

    if error == AX_ERROR_SUCCESS && pid > 0 {
        Some(pid)
    } else {
        None
    }
}

/// 把进程号为 `pid` 的应用切回前台（设它的 `AXFrontmost`）。请求被接受返回 true。
///
/// 浮窗「替换原文」用：用户点浮窗时 umuo 自己被激活了，要先把焦点还给源应用，
/// 写回才会落到源应用的输入框里。走 AX 而不是 `NSRunningApplication`：
/// 不为这一处多引一个 AppKit 绑定。返回 true 只表示系统接受了请求，
/// 焦点真正回来要由调用方再看前台 pid 确认。
pub fn activate_pid(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    let application = unsafe { AXUIElementCreateApplication(pid) };
    if application.is_null() {
        return false;
    }
    let key = CFString::new("AXFrontmost");
    let error = unsafe {
        AXUIElementSetAttributeValue(
            application,
            key.as_concrete_TypeRef(),
            CFBoolean::true_value().as_CFTypeRef(),
        )
    };
    unsafe { release(application) };
    error == AX_ERROR_SUCCESS
}

/// 聚焦元素的某个属性是否可写。
///
/// 返回 `None` 表示**问不出来**（没有聚焦元素、该 App 不支持这个属性）——
/// 与「明确不可写」不同：Electron 一类 App 常常问不出来，却能接受粘贴。
pub fn is_settable(attribute: &str) -> Option<bool> {
    let element = focused_element()?;
    let key = CFString::new(attribute);
    let mut settable: u8 = 0;
    let error = unsafe {
        AXUIElementIsAttributeSettable(element, key.as_concrete_TypeRef(), &mut settable)
    };
    unsafe { release(element) };
    (error == AX_ERROR_SUCCESS).then_some(settable != 0)
}

/// 把聚焦元素的一个字符串属性设成 `text`。成功返回 true。
fn set_string_attribute(attribute: &str, text: &str) -> bool {
    let Some(element) = focused_element() else {
        return false;
    };
    let attribute = CFString::new(attribute);
    let value = CFString::new(text);
    let error = unsafe {
        AXUIElementSetAttributeValue(
            element,
            attribute.as_concrete_TypeRef(),
            value.as_concrete_TypeRef() as *const c_void,
        )
    };
    unsafe { release(element) };
    error == AX_ERROR_SUCCESS
}

/// 用 AX 直接改写选区内容。成功返回 true。
///
/// 选区长度为 0 时，这等于在光标处**插入**——要替换整个输入框请用 [`set_focused_value`]。
pub fn set_selected_text(text: &str) -> bool {
    set_string_attribute("AXSelectedText", text)
}

/// 用 AX 把聚焦元素的整个值换成 `text`（整框替换）。成功返回 true。
pub fn set_focused_value(text: &str) -> bool {
    set_string_attribute("AXValue", text)
}

/// 把一个 +1 的 CFString 转成 Rust 字符串并释放它。
///
/// # Safety
/// `ptr` 必须是 CFString，且按 create/copy 规则拿到。
unsafe fn cf_string_to_string(ptr: *const c_void) -> Option<String> {
    // 先验类型：AX 属性可能回的是数组或数字（例如多选场景），
    // 直接当 CFString 解会读到垃圾数据而不是干脆失败。
    if CFGetTypeID(ptr) != CFStringGetTypeID() {
        release(ptr);
        return None;
    }
    let cf = CFString::wrap_under_create_rule(ptr as CFStringRef);
    Some(cf.to_string())
}
