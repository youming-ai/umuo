import Testing
import UmuoCore
@testable import Umuo

// 浮窗视图模型的交互规则。
// backend 换成只记调用的假实现：不开窗口、不碰 Engine、剪贴板与 AX。

@MainActor
private final class FakeBackend: PanelBackend {
    var translated: [TranslateRequest] = []
    var cancelled = 0
    var hidden = 0
    var copied: [String] = []
    var copyFailure: String?
    var spoken: [String] = []
    var replaceResult: String?
    var replaced: [(String, String?)] = []
    var composed: [(String, String?, String?)] = []
    var settingsOpened = 0
    var systemSettings: [PermissionKind] = []

    func translate(_ request: TranslateRequest) { translated.append(request) }
    func cancelTranslation() { cancelled += 1 }
    func hidePanel() { hidden += 1 }
    func copy(_ text: String) async -> String? {
        copied.append(text)
        return copyFailure
    }

    func speak(_ text: String) { spoken.append(text) }
    func stopSpeaking() {}
    func replace(_ text: String, owner: String?) async -> String? {
        replaced.append((text, owner))
        return replaceResult
    }

    func openCompose(text: String, translation: String?, owner: String?) { composed.append((text, translation, owner)) }
    func openSettings() { settingsOpened += 1 }
    func openSystemSettings(_ permission: PermissionKind) { systemSettings.append(permission) }
}

/// 写回要等测试放行才返回：用来模拟「写回期间浮窗换成了新的一次翻译」。
@MainActor
private final class SlowReplaceBackend: PanelBackend {
    private var pending: CheckedContinuation<String?, Never>?

    func translate(_: TranslateRequest) {}
    func cancelTranslation() {}
    func hidePanel() {}
    func copy(_: String) async -> String? { nil }
    func speak(_: String) {}
    func stopSpeaking() {}
    func replace(_: String, owner _: String?) async -> String? {
        await withCheckedContinuation { pending = $0 }
    }

    func finish(_ result: String?) {
        pending?.resume(returning: result)
        pending = nil
    }

    func openCompose(text _: String, translation _: String?, owner _: String?) {}
    func openSettings() {}
    func openSystemSettings(_: PermissionKind) {}
}

private func route(_ id: UInt64) -> Route { Route(surface: "panel", requestId: id) }

private func start(_ id: UInt64, _ text: String = "Hello world", mode: String = "selection") -> TranslateEvent {
    .start(text: text, provider: "OpenAI", model: "gpt-4o-mini", targetLang: "中文", wordMode: false, mode: mode)
}

private let doneEvent = TranslateEvent.done(warning: nil, model: "gpt-4o-mini", inputTokens: 1, outputTokens: 1,
                                            estimated: false, firstTokenMs: nil, totalMs: 10,
                                            replaced: false)

/// 让 session 里起的 Task 跑完（假 backend 的方法都立即返回）。
private func settle() async {
    for _ in 0 ..< 20 { await Task.yield() }
}

@MainActor
private func translatedSession(mode: String = "selection", text: String = "Hello world")
    -> (PanelSession, FakeBackend)
{
    let backend = FakeBackend()
    let session = PanelSession(backend: backend)
    session.apply(route: route(1), event: start(1, text, mode: mode))
    session.apply(route: route(1), event: .delta(text: "你好世界"))
    session.apply(route: route(1), event: doneEvent)
    return (session, backend)
}

@Suite("浮窗视图模型")
@MainActor
struct PanelSessionTests {
    @Test func 新的一次翻译重置可改原文与提示() {
        let session = PanelSession(backend: FakeBackend())
        session.actionNotice = "上一次的提示"
        session.apply(route: route(1), event: start(1, "识别的原文", mode: "ocr"))
        #expect(session.draft == "识别的原文")
        #expect(session.actionNotice == nil)
    }

    @Test func 展开的长原文在下一次翻译开始时收回() {
        let session = PanelSession(backend: FakeBackend())
        session.apply(route: route(1), event: start(1, "很长的原文"))
        session.sourceExpanded = true
        session.apply(route: route(2), event: start(2, "下一段"))
        #expect(!session.sourceExpanded)
    }

    @Test func 被顶掉的旧请求不改窗口状态() async {
        let backend = FakeBackend()
        let session = PanelSession(backend: backend)
        session.apply(route: route(2), event: start(2, "新的"))
        // 迟到的旧 start：丢掉，可改原文不跟着变
        #expect(!session.apply(route: route(1), event: start(1, "旧的")))
        #expect(session.draft == "新的")
    }

    @Test func Esc翻译中取消_空闲时收起() {
        let backend = FakeBackend()
        let session = PanelSession(backend: backend)
        session.apply(route: route(1), event: start(1))
        session.escape()
        #expect(backend.cancelled == 1 && backend.hidden == 0)
        session.apply(route: route(1), event: doneEvent)
        session.escape()
        #expect(backend.cancelled == 1 && backend.hidden == 1)
    }

    @Test func 半截译文不能复制替换() {
        let backend = FakeBackend()
        let session = PanelSession(backend: backend)
        session.apply(route: route(1), event: start(1))
        session.apply(route: route(1), event: .delta(text: "你好"))
        #expect(!session.canCopy && !session.canReplace)
        session.copy()
        session.replace()
        #expect(backend.copied.isEmpty && backend.replaced.isEmpty)
    }

    @Test func 出错时保留的半段译文能复制但不能替换() {
        let backend = FakeBackend()
        let session = PanelSession(backend: backend)
        session.apply(route: route(1), event: start(1))
        session.apply(route: route(1), event: .delta(text: "你好"))
        session.apply(route: route(1), event: .error(message: "连接中断", actions: [.retry], needsPermission: false,
                                                     permission: nil, source: nil))
        #expect(session.canCopy)
        #expect(!session.canReplace)
    }

    @Test func 替换原文写回浮窗归属的应用并说明结果() async {
        let (session, backend) = translatedSession()
        session.owner = "4242"
        backend.replaceResult = "目标应用已切换，已放弃替换原文"
        session.replace()
        await settle()
        #expect(session.actionNotice == "替换失败：目标应用已切换，已放弃替换原文")
        // 失败了可以再试
        #expect(session.canReplace)

        backend.replaceResult = nil
        session.replace()
        await settle()
        #expect(backend.replaced.map(\.0) == ["你好世界", "你好世界"])
        #expect(backend.replaced.map(\.1) == ["4242", "4242"])
        #expect(session.actionNotice == "已替换原文")
    }

    @Test func 替换原文只写回一次_连点与成功后再点都不重复插入() async {
        let (session, backend) = translatedSession()
        session.owner = "4242"
        session.replace()
        session.replace() // 双击：第一次还没回来
        #expect(!session.canReplace)
        await settle()
        session.replace() // 成功之后再点
        await settle()
        #expect(backend.replaced.count == 1)
        #expect(!session.canReplace)

        // 新的一次翻译又可以替换
        session.apply(route: route(2), event: start(2))
        session.apply(route: route(2), event: .delta(text: "新的译文"))
        session.apply(route: route(2), event: doneEvent)
        #expect(session.canReplace)
    }

    @Test func 静默替换已写回与OCR结果不给替换原文() {
        let replacedDone = TranslateEvent.done(warning: nil, model: "gpt-4o-mini", inputTokens: 1, outputTokens: 1,
                                               estimated: false, firstTokenMs: nil, totalMs: 10, replaced: true)
        let session = PanelSession(backend: FakeBackend())
        session.apply(route: route(1), event: start(1, mode: "silentReplace"))
        session.apply(route: route(1), event: .delta(text: "你好世界"))
        session.apply(route: route(1), event: replacedDone)
        #expect(!session.canReplace)

        // 静默替换被守卫拦下、没有写回：仍可手动替换
        let (refused, _) = translatedSession(mode: "silentReplace")
        #expect(refused.canReplace)

        let (ocr, _) = translatedSession(mode: "ocr", text: "截图里的字")
        #expect(!ocr.canReplace)
    }

    @Test func 写回期间换了新翻译_旧结果的提示不落在新译文上() async {
        let backend = SlowReplaceBackend()
        let session = PanelSession(backend: backend)
        session.apply(route: route(1), event: start(1))
        session.apply(route: route(1), event: .delta(text: "你好世界"))
        session.apply(route: route(1), event: doneEvent)
        session.owner = "4242"
        session.replace()
        await settle()
        session.apply(route: route(2), event: start(2, "Another"))
        backend.finish(nil)
        await settle()
        #expect(session.actionNotice == nil)
        session.apply(route: route(2), event: .delta(text: "另一句"))
        session.apply(route: route(2), event: doneEvent)
        #expect(session.canReplace)
    }

    @Test func 复制失败要说出来() async {
        let (session, backend) = translatedSession()
        session.copy()
        await settle()
        #expect(backend.copied == ["你好世界"])
        #expect(session.actionNotice == nil)
        backend.copyFailure = "复制失败：剪贴板不可用：写入失败"
        session.copy()
        await settle()
        #expect(session.actionNotice == "复制失败：剪贴板不可用：写入失败")
    }

    @Test func OCR结果窗的重译保住ocr模式() {
        let (session, backend) = translatedSession(mode: "ocr", text: "识别有错")
        session.retry()
        #expect(backend.translated.last?.mode == .ocr)

        // 没改原文、或改成空白：不给重译
        #expect(!session.canRetranslateDraft)
        session.draft = "   "
        #expect(!session.canRetranslateDraft)
        session.draft = "  识别无误 "
        session.retranslateDraft()
        #expect(backend.translated.last?.text == "识别无误")
        #expect(backend.translated.last?.mode == .ocr)
    }

    @Test func 重试_划词走首次翻译的路径_OCR保住模式() {
        let backend = FakeBackend()
        let session = PanelSession(backend: backend)
        session.apply(route: route(1), event: start(1, " Hello "))
        session.apply(route: route(1), event: .error(message: "请求过于频繁", actions: [.retry], needsPermission: false,
                                                     permission: nil, source: nil))
        session.retry()
        #expect(backend.translated.last?.mode == .selection)
        #expect(backend.translated.last?.text == " Hello ")

        session.apply(route: route(2), event: start(2, "截图里的字", mode: "ocr"))
        session.apply(route: route(2), event: .error(message: "超时", actions: [.retry], needsPermission: false,
                                                     permission: nil, source: nil))
        session.retry()
        #expect(backend.translated.last?.mode == .ocr)
    }

    @Test func 缺权限的错误送去对应的系统设置面板() {
        let backend = FakeBackend()
        let session = PanelSession(backend: backend)
        session.apply(.error(PanelError(requestId: 3, message: "", actions: [], needsPermission: true,
                                        permission: .screenRecording, source: nil)))
        #expect(session.errorText == "缺少系统权限。")
        session.openSystemSettings()
        session.apply(.error(PanelError(requestId: 4, message: "需要系统权限：辅助功能", actions: [],
                                        needsPermission: true, permission: .accessibility, source: nil)))
        #expect(session.errorText == "需要系统权限：辅助功能")
        session.openSystemSettings()
        #expect(backend.systemSettings == [.screenRecording, .accessibility])
    }

    @Test func 只有打开模型设置的建议才给模型设置按钮() {
        let session = PanelSession()
        session.apply(.error(PanelError(requestId: nil, message: "x", actions: [.openModelSettings],
                                        needsPermission: false, permission: nil, source: nil)))
        #expect(session.offersModelSettings)
        session.apply(.error(PanelError(requestId: nil, message: "x", actions: [.retry, .checkNetwork],
                                        needsPermission: false, permission: nil, source: nil)))
        #expect(!session.offersModelSettings)
    }

    @Test func 在撰写窗打开带上原文译文与浮窗归属() {
        let (session, backend) = translatedSession()
        session.owner = "777"
        session.openCompose()
        #expect(backend.composed.map(\.0) == ["Hello world"])
        #expect(backend.composed.map(\.1) == ["你好世界"])
        #expect(backend.composed.map(\.2) == ["777"])
    }

    @Test func 只有OCR结果窗的原文可编辑() {
        #expect(!translatedSession(mode: "selection").0.editableSource)
        #expect(translatedSession(mode: "ocr").0.editableSource)
    }

    @Test func 钉住是窗口状态() {
        let session = PanelSession()
        #expect(session.capturesGlobalEscape)
        session.togglePin()
        #expect(session.pinned)
        #expect(!session.capturesGlobalEscape, "钉住且空闲时不应抢占全局 Esc")
        session.apply(route: route(1), event: start(1))
        #expect(session.capturesGlobalEscape, "钉住状态下流式翻译进行中仍可按 Esc 取消")
        session.apply(route: route(1), event: doneEvent)
        #expect(!session.capturesGlobalEscape, "流式翻译完成后再次释放全局 Esc")
        session.togglePin()
        #expect(!session.pinned)
        #expect(session.capturesGlobalEscape)
    }
}
