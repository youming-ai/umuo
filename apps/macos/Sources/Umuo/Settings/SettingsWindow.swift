import AppKit
import SwiftUI

/// 设置窗的宿主：普通的可聚焦窗口（与浮窗不同，设置要打字、要成为 key），一个进程只有一个，关掉再开复用同一个窗口与模型。
///
/// - 菜单栏应用（`.accessory`）开窗口前要先 `activate`，否则窗口开在当前前台应用的后面。
/// - 关掉再打开时整份重新载入（`SettingsModel.reopen`：各页草稿清空、设置与 Key 状态重读、初始分区重算），并换一个新的
///   `NSHostingView`，视图里的残留（文本框草稿、滚动位置）也从头开始。
///   窗口开着、只是重新成为 key 时，只重查权限与设置（`windowFocused`）。
/// - 录快捷键：窗口上挂一个本地按键监听，录键时把按键交给 `HotkeyEditor` 并吞掉；窗口失去 key、关闭时结束录制，
///   全局快捷键随之恢复（`HotkeyCenter.setRecording`）。
@MainActor
final class SettingsWindowController: NSObject, NSWindowDelegate {
    unowned let app: AppModel
    private var window: NSWindow?
    private var model: SettingsModel?
    private var monitor: Any?

    init(app: AppModel) {
        self.app = app
    }

    func show() {
        let model = model ?? makeModel()
        let fresh = window == nil
        let window = window ?? makeWindow(model)
        let reopening = !fresh && !window.isVisible && !window.isMiniaturized
        if reopening {
            // 换一套新的分区视图：文本框草稿、滚动位置都从头开始；窗口大小保持用户上次调的
            let frame = window.frame
            window.contentViewController = SettingsPaneController(model: model, updater: app.updater)
            window.setFrame(frame, display: false)
        }
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        if reopening {
            Task { await model.reopen() }
        } else if !model.isLoaded {
            // 窗口开着：成为 key 时的刷新（`windowDidBecomeKey`）就够了。上次载入失败的再试一次。
            Task { await model.load() }
        }
    }

    /// 内核刚打开：设置窗若在内核就绪前就开了（载入失败、停在「内核启动中」），现在重新载入。
    func engineReady() {
        guard let model, let window, window.isVisible, !model.isLoaded else { return }
        Task { await model.load() }
    }

    private func makeModel() -> SettingsModel {
        let model = SettingsModel(backend: EngineSettingsBackend(app: app))
        // 快捷键重注册完成后重新读失败清单（比猜一个延时可靠）
        app.hotkeys.onRegistered = { [weak model] in model?.hotkeysRegistered() }
        self.model = model
        return model
    }

    private func makeWindow(_ model: SettingsModel) -> NSWindow {
        // 偏好设置样式：顶部图标工具栏切分区，窗口标题跟着当前分区走（`NSTabViewController` 负责）
        let window = NSWindow(contentViewController: SettingsPaneController(model: model, updater: app.updater))
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
        window.toolbarStyle = .preference
        window.contentMinSize = SettingsPaneController.paneSize
        window.setContentSize(NSSize(width: 680, height: 560))
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        self.window = window
        installKeyMonitor(window)
        return window
    }

    /// 录键：只在有一行在录、且事件发生在设置窗里时才接管；其余事件原样放行。
    private func installKeyMonitor(_ window: NSWindow) {
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .flagsChanged, .leftMouseDown, .rightMouseDown,
                                                              .otherMouseDown]) { [weak self, weak window] event in
            guard let window, event.window === window else { return event }
            // 本地监听在主线程上回调；NSEvent 不是 Sendable，只把要用的几个值带进 MainActor
            let input = RecorderInput(event)
            let consumed = MainActor.assumeIsolated { self?.route(input) ?? false }
            return consumed ? nil : event
        }
    }

    /// 一次按键事件里录键器要的部分。
    struct RecorderInput: Sendable {
        let type: NSEvent.EventType
        let keyCode: UInt16
        let flags: UInt
        let ms: UInt64

        init(_ event: NSEvent) {
            type = event.type
            keyCode = event.type == .keyDown || event.type == .flagsChanged ? event.keyCode : 0
            flags = event.modifierFlags.rawValue
            ms = UInt64(event.timestamp * 1000)
        }
    }

    /// 交给录键器。返回 true = 吞掉这个事件。没有一行在录时什么都不做。
    private func route(_ input: RecorderInput) -> Bool {
        guard let editor = model?.hotkeys, editor.recording != nil else { return false }
        switch input.type {
        case .keyDown:
            // 认不出的键交给录键器说「录不了」
            let code = HotkeyFormat.code(keyCode: input.keyCode) ?? "Unidentified"
            let flags = NSEvent.ModifierFlags(rawValue: input.flags)
            let key = HotkeyFormat.Key(code: code, ctrl: flags.contains(.control), alt: flags.contains(.option),
                                       shift: flags.contains(.shift), cmd: flags.contains(.command))
            return editor.keyDown(key, atMs: input.ms)
        case .flagsChanged:
            return editor.modifiersChanged(keyCode: input.keyCode, flags: UInt64(input.flags), atMs: input.ms)
        default:
            // 点鼠标打断连按，但点击照常生效（点别的键帽要能换一行录）
            editor.pointer(atMs: input.ms)
            return false
        }
    }

    // MARK: - NSWindowDelegate

    func windowDidBecomeKey(_: Notification) {
        guard let model else { return }
        Task { await model.windowFocused() }
    }

    func windowDidResignKey(_: Notification) {
        model?.hotkeys.stop()
    }

    func windowWillClose(_: Notification) {
        model?.windowClosed()
    }
}
