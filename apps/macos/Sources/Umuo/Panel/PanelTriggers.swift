import AppKit
import UmuoCore

/// 快捷键 / 菜单栏触发的浮窗功能：划词翻译、原地替换、截图翻译。
/// 对应 Tauri 的 `translator::trigger*` 与 `screenshot::trigger*`，分支与文案逐条一致。
///
/// 取词、框选、识别都是阻塞的（⌘C 降级最长约 1 秒，框选一直等到用户松手），全部在 `Task.detached` 里做；
/// 只有显示浮窗、改 session、朗读回到 MainActor。
extension PanelController {
    func triggerSelection() { triggerTranslation(silent: false) }

    /// 输入框原地替换（静默翻译，PRD §5.4）。
    func triggerSilentReplace() { triggerTranslation(silent: true) }

    private func triggerTranslation(silent: Bool) {
        guard let engine = app.engine else { return showNotice(app.engineStatus, permission: nil) }
        let wakeStarted = ContinuousClock.now
        Task.detached {
            // 按下快捷键就顶掉浮窗上一次的请求：哪怕这次取词失败，旧译文也不该继续流进来。
            // 取词成功后也用这张凭据翻译（`startTranslation(ticketId:)`），先按的键不会因为取词慢而后来居上。
            let id = engine.beginRequest(surface: Self.surface)

            // PRD §7.3 的取词黑名单：密码管理器等应用**在读取之前**就拦下，并用浮窗说清楚。
            if let notice = Self.blockNotice(engine) {
                await MainActor.run {
                    self.showNearCursor()
                    self.report(requestId: id, message: notice, permission: nil, actions: [.openModelSettings])
                }
                return
            }

            // 写回前要确认目标应用没被换掉，所以先记下它的标识（必须现查，不读缓存）。
            let guardToken = silent ? FrontmostApp.liveToken() : nil
            // 静默翻译：没有选区时读整个输入框，且不做剪贴板降级（写回依赖同一条通道）；来源一路带到写回。
            let read = silent
                ? Result { () throws(SelectionError) in try Selection.readFocusText() }
                : Result { () throws(SelectionError) in FocusText(text: try Selection.readSelection(), source: .selection) }
            let readMs = (ContinuousClock.now - wakeStarted).milliseconds

            await MainActor.run {
                self.showNearCursor()
                print("umuo: 取词耗时 \(readMs)ms\(read.isSuccess ? "" : "（失败）")；唤起耗时 \((ContinuousClock.now - wakeStarted).milliseconds)ms")
                switch read {
                case let .failure(error):
                    let permission: PermissionKind? = error == .permissionDenied ? .accessibility : nil
                    self.report(requestId: id, message: error.description, permission: permission)
                case let .success(focus):
                    self.startTranslation(
                        TranslateRequest(text: focus.text, mode: silent ? .silentReplace : .selection,
                                         targetOverride: nil, sourceOverride: nil,
                                         focusSource: silent ? focus.source : nil),
                        guardToken: guardToken, ticketId: id
                    )
                }
            }
        }
    }

    /// 不经取词的文本入口：首次引导的「翻一句看看」（Tauri 的 `translate_text`）。
    /// 与划词同一条流水线（只显示、不写回）；这条入口不取词，浮窗要自己弹出来，成功时也看得到结果（审查 H3）。
    /// 只有空白时抛出 `empty`。
    func translateText(_ text: String, empty: String) throws {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw EngineError.Failed(message: empty) }
        ensureShown()
        startTranslation(TranslateRequest(text: trimmed, mode: .selection, targetOverride: nil, sourceOverride: nil,
                                          focusSource: nil))
    }

    /// 系统框选后在本机识别，结果交给 OCR 翻译流水线。
    func triggerOcr() {
        Task.detached {
            let outcome = ScreenOCR.run()
            await MainActor.run {
                switch outcome {
                case .cancelled:
                    return
                case let .notice(message, permission):
                    self.showNotice(message, permission: permission.flatMap(PermissionKind.init(rawValue:)))
                case let .recognized(text):
                    self.ensureShown()
                    self.startTranslation(TranslateRequest(
                        text: text, mode: .ocr, targetOverride: nil, sourceOverride: nil, focusSource: nil
                    ))
                }
            }
        }
    }

    /// 黑名单要的前台应用名：**现查**（pid → NSRunningApplication），不读激活通知的缓存——
    /// 那是安全闸，缓存晚一拍就会让刚切到的密码管理器漏过去。取不到 pid（没有辅助功能权限）时不拦：
    /// 紧接着的取词同样要这个权限，会如实报缺权限。
    nonisolated static func blockNotice(_ engine: Engine) -> String? {
        let name = FrontmostApp.liveToken().flatMap(pid_t.init)
            .flatMap { NSRunningApplication(processIdentifier: $0)?.localizedName }
        guard let name else { return nil }
        return engine.selectionBlockNotice(appName: name)
    }
}

private extension Result {
    var isSuccess: Bool { if case .success = self { true } else { false } }
}

private extension Duration {
    var milliseconds: Int64 { components.seconds * 1000 + components.attoseconds / 1_000_000_000_000_000 }
}
