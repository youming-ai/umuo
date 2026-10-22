import Testing
import UmuoCore
@testable import Umuo

// 浮窗视图模型的交互规则（`apps/desktop/src/panel.tsx` 里按钮的条件与动作）。
// backend 换成只记调用的假实现：不开窗口、不碰 Engine、剪贴板与 AX。

@MainActor
private final class FakeBackend: PanelBackend {
    var translated: [TranslateRequest] = []
    var cancelled = 0
    var hidden = 0
    var copied: [String] = []
    var copyFailure: String?
    var spoken: [String] = []
    var favoriteResult: Result<Bool, EngineError> = .success(true)
    var favoriteToggles: [(String, String?)] = []
    var favoriteStatusValue = false
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
    func favoriteToggle(text: String, translation: String?) async throws -> Bool {
        favoriteToggles.append((text, translation))
        return try favoriteResult.get()
    }

    func favoriteStatus(_: String) async -> Bool { favoriteStatusValue }
    func replace(_ text: String, owner: String?) async -> String? {
        replaced.append((text, owner))
        return replaceResult
    }

    func openCompose(text: String, translation: String?, owner: String?) { composed.append((text, translation, owner)) }
    func openSettings() { settingsOpened += 1 }
    func openSystemSettings(_ permission: PermissionKind) { systemSettings.append(permission) }
}

private func route(_ id: UInt64) -> Route { Route(surface: "panel", requestId: id, back: false) }

private func start(_ id: UInt64, _ text: String = "Hello world", mode: String = "selection") -> TranslateEvent {
    .start(text: text, provider: "OpenAI", model: "gpt-4o-mini", targetLang: "中文", wordMode: false, mode: mode)
}

private let doneEvent = TranslateEvent.done(warning: nil, model: "gpt-4o-mini", inputTokens: 1, outputTokens: 1,
                                            estimated: false, costUsd: nil, firstTokenMs: nil, totalMs: 10,
                                            replaced: false, offline: false)

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
    @Test func 新的一次翻译重置可改原文与提示并查一次收藏状态() async {
        let backend = FakeBackend()
        backend.favoriteStatusValue = true
        let session = PanelSession(backend: backend)
        session.actionNotice = "上一次的提示"
        session.apply(route: route(1), event: start(1, "识别的原文", mode: "ocr"))
        #expect(session.draft == "识别的原文")
        #expect(session.actionNotice == nil)
        await settle()
        #expect(session.favorited)
    }

    @Test func 被顶掉的旧请求不改窗口状态() async {
        let backend = FakeBackend()
        let session = PanelSession(backend: backend)
        session.apply(route: route(2), event: start(2, "新的"))
        // 迟到的旧 start：丢掉，可改原文不跟着变
        #expect(!session.apply(route: route(1), event: start(1, "旧的")))
        #expect(session.draft == "新的")
    }

    @Test func 收藏状态回来时已经换了请求就不认() async {
        let backend = FakeBackend()
        backend.favoriteStatusValue = true
        let session = PanelSession(backend: backend)
        session.apply(route: route(1), event: start(1, "第一次"))
        backend.favoriteStatusValue = false
        session.apply(route: route(2), event: start(2, "第二次"))
        await settle()
        #expect(!session.favorited)
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

    @Test func 半截译文不能复制替换收藏() {
        let backend = FakeBackend()
        let session = PanelSession(backend: backend)
        session.apply(route: route(1), event: start(1))
        session.apply(route: route(1), event: .delta(text: "你好"))
        #expect(!session.canCopy && !session.canReplace && !session.canFavorite)
        session.copy()
        session.replace()
        session.toggleFavorite()
        #expect(backend.copied.isEmpty && backend.replaced.isEmpty && backend.favoriteToggles.isEmpty)
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
        session.replace()
        await settle()
        #expect(backend.replaced.map(\.0) == ["你好世界"])
        #expect(backend.replaced.map(\.1) == ["4242"])
        #expect(session.actionNotice == "已替换原文")

        backend.replaceResult = "目标应用已切换，已放弃替换原文"
        session.replace()
        await settle()
        #expect(session.actionNotice == "替换失败：目标应用已切换，已放弃替换原文")
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

    @Test func 收藏存完整译文_失败显示原因() async {
        let (session, backend) = translatedSession()
        session.toggleFavorite()
        await settle()
        #expect(backend.favoriteToggles.map(\.0) == ["Hello world"])
        #expect(backend.favoriteToggles.map(\.1) == ["你好世界"])
        #expect(session.favorited)

        backend.favoriteResult = .failure(.Failed(message: "历史库打不开"))
        session.toggleFavorite()
        await settle()
        #expect(session.actionNotice == "历史库打不开")
        #expect(session.favorited)
    }

    @Test func 换模型只覆盖这一次并说明正在重译() {
        let (session, backend) = translatedSession()
        let provider = ProviderDetail(id: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat",
                                      suggestedModels: [], keysUrl: "", requiresKey: true, requiresBaseUrl: false,
                                      local: false)
        session.switchModel(provider)
        #expect(session.actionNotice == "正在用 DeepSeek 重译…")
        let request = backend.translated.last
        #expect(request?.mode == .selection)
        #expect(request?.providerOverride == "deepseek")
        #expect(request?.modelOverride == "deepseek-chat")
        #expect(request?.styleOverride == nil)
        #expect(request?.focusSource == nil)
    }

    @Test func OCR结果窗的重译保住ocr模式() {
        let (session, backend) = translatedSession(mode: "ocr", text: "识别有错")
        session.switchStyle("formal")
        #expect(backend.translated.last?.mode == .ocr)
        #expect(backend.translated.last?.styleOverride == "formal")
        #expect(session.actionNotice == "正在换风格重译…")

        // 没改原文、或改成空白：不给重译
        #expect(!session.canRetranslateDraft)
        session.draft = "   "
        #expect(!session.canRetranslateDraft)
        session.draft = "  识别无误 "
        session.retranslateDraft()
        #expect(backend.translated.last?.text == "识别无误")
        #expect(backend.translated.last?.mode == .ocr)
    }

    @Test func 换风格的空选项什么都不做() {
        let (session, backend) = translatedSession()
        session.switchStyle("")
        #expect(backend.translated.isEmpty)
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

    @Test func 换模型类的建议都给打开模型设置() {
        let session = PanelSession()
        for action in [SuggestedAction.switchModel, .openModelSettings, .useLocalModel] {
            session.apply(.error(PanelError(requestId: nil, message: "x", actions: [action], needsPermission: false,
                                            permission: nil, source: nil)))
            #expect(session.offersModelSettings)
        }
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
        session.togglePin()
        #expect(session.pinned)
        session.togglePin()
        #expect(!session.pinned)
    }
}
