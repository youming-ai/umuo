import AppKit
import UmuoCore

/// 快捷键 / 菜单栏触发的浮窗功能：划词翻译、原地替换、截图翻译。
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
        // 取完时不再是最新的按键（之后又按了一次、按了 Esc、浮窗换成了截图翻译）：什么都不做
        let sequence = triggers.begin()
        session.writeTarget = nil
        // 按下快捷键就顶掉浮窗上一次的请求：哪怕这次取词失败，旧译文也不该继续流进来。
        // 取词成功后也用这张凭据翻译（`startTranslation(ticketId:)`），先按的键不会因为取词慢而后来居上。
        // 在主线程上按按键顺序登记（只是加锁改一张表，不等 IO）：放进各自的后台任务，连按两次时
        // 登记顺序可能颠倒，后按的那次拿到小 id、被判成已顶掉，浮窗就停在加载上。
        let id = engine.beginRequest(surface: Self.surface)
        Task.detached {
            let blockNotice = { (owner: String) throws(SelectionError) -> String? in
                guard let pid = pid_t(owner), let app = NSRunningApplication(processIdentifier: pid),
                      let name = app.localizedName ?? app.bundleIdentifier else {
                    throw Selection.refuse("前台进程 \(owner) 已不在或没有名字",
                                           key: silent ? "error.targetChanged" : Selection.selectionChanged)
                }
                return engine.selectionBlockNotice(appName: name)
            }
            let read = silent
                ? Result { () throws(SelectionError) in try Selection.readFocusText(blockNotice: blockNotice) }
                : Result { () throws(SelectionError) in try Selection.readPanelSelection(blockNotice: blockNotice) }
            let readMs = (ContinuousClock.now - wakeStarted).milliseconds

            await MainActor.run {
                // 旧按键取得慢、后取完：不挪浮窗、不重设归属、不把已收起的浮窗弹回来，也不报错
                guard self.triggers.isCurrent(sequence) else { return }
                self.showNearCursor()
                print("umuo: 取词耗时 \(readMs)ms\(read.isSuccess ? "" : "（失败）")；唤起耗时 \((ContinuousClock.now - wakeStarted).milliseconds)ms")
                switch read {
                case let .failure(.blocked(message)):
                    self.report(requestId: id, message: message, permission: nil, actions: [.openModelSettings])
                case let .failure(error):
                    let permission: PermissionKind? = error == .permissionDenied ? .accessibility : nil
                    self.report(requestId: id, message: self.session.t(error.text), permission: permission)
                case let .success(focus):
                    self.setWriteTarget(focus.source == .selection ? focus.writeTarget : nil, owner: focus.owner)
                    self.session.pendingStart = id
                    self.startTranslation(
                        TranslateRequest(text: focus.text, mode: silent ? .silentReplace : .selection,
                                         targetOverride: nil, sourceOverride: nil,
                                         focusSource: silent ? focus.source : nil),
                        writeTarget: focus.writeTarget, ticketId: id
                    )
                }
            }
        }
    }

    /// 不经取词的文本入口：首次引导的「翻一句看看」。
    /// 与划词同一条流水线（只显示、不写回）；这条入口不取词，浮窗要自己弹出来，成功时也看得到结果（审查 H3）。
    /// 只有空白时抛出 `empty`。
    func translateText(_ text: String, empty: String) throws {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw EngineError.Failed(message: empty) }
        ensureShown()
        startTranslation(TranslateRequest(text: trimmed, mode: .selection, targetOverride: nil, sourceOverride: nil,
                                          focusSource: nil))
    }

    /// 外部链接入口（`umuo://translate`，PopClip 扩展）：文本由调用方给出，不取词。
    /// 浮窗像划词一样弹在鼠标旁，归属取当时的前台应用（切走即收起、撰写窗可粘回）；没有可写回的选区。
    func translateExternal(_ text: String) {
        guard let engine = app.engine else { return showNotice(app.engineStatus, permission: nil) }
        triggers.invalidate()
        showNearCursor()
        startAwaitingStart(TranslateRequest(text: text, mode: .selection, targetOverride: nil, sourceOverride: nil,
                                            focusSource: nil), engine: engine)
    }

    /// 先登记请求并记为等待 Start，再交给流水线：Start 到达前按 Esc 或 ✕，取消的是这次请求，而不只是收起浮窗。
    func startAwaitingStart(_ request: TranslateRequest, engine: Engine) {
        let id = engine.beginRequest(surface: Self.surface)
        session.pendingStart = id
        startTranslation(request, ticketId: id)
    }

    /// 系统框选后在本机识别，结果交给 OCR 翻译流水线。
    ///
    /// 框选进行中再次触发直接忽略（返回 nil）：否则会再起一个框选，两次结果各自开始翻译、后到的覆盖先到的。
    /// 划词那边是「新按键顶掉旧按键」（`TriggerGate`），这里不同——框选要等用户操作，第二个框选只会叠在第一个上面。
    ///
    /// `run` 是框选 + 识别（阻塞到用户松手），测试换成可控的闭包。返回后台任务；没有起新任务时返回 nil。
    @discardableResult
    func triggerOcr(run: @escaping @Sendable () -> ScreenOCR.Outcome = { ScreenOCR.run() }) -> Task<Void, Never>? {
        guard !ocrInFlight else { return nil }
        ocrInFlight = true
        let sequence = triggers.begin()
        return Task.detached {
            let outcome = run()
            await MainActor.run {
                // 所有结果（含取消）都要放开，否则之后再也触发不了
                self.ocrInFlight = false
                guard self.triggers.isCurrent(sequence) else { return }
                switch outcome {
                case .cancelled:
                    return
                case let .notice(_, permission):
                    self.showNotice(outcome.message(self.session.t) ?? "",
                                    permission: permission.flatMap(PermissionKind.init(rawValue:)))
                case .failed:
                    self.showNotice(outcome.message(self.session.t) ?? "", permission: nil)
                case let .recognized(text):
                    self.ensureShown()
                    self.startTranslation(TranslateRequest(
                        text: text, mode: .ocr, targetOverride: nil, sourceOverride: nil, focusSource: nil
                    ))
                }
            }
        }
    }
}

private extension Result {
    var isSuccess: Bool { if case .success = self { true } else { false } }
}

private extension Duration {
    var milliseconds: Int64 { components.seconds * 1000 + components.attoseconds / 1_000_000_000_000_000 }
}
