import AppKit
import SwiftUI
import UmuoCore

/// 语音浮层：屏幕下方居中的非激活面板，显示录音中 / 转写中 / 完成 / 错误，以及首次使用时的模型下载。
///
/// 与翻译浮窗同一套系统外壳（`FloatingPanelChrome`，macOS 26 为 Liquid Glass），不自造配色与字号。
/// 非激活：按住说话时焦点留在用户正在打字的应用里，完整结果交付到那里（交付成功即收起）。
/// Esc 与翻译浮窗共用 `EscapeRouter`：可见期间认领系统级 Esc（面板不是 key，收不到 keyDown），收起即交还；
/// 两边同时可见时 Esc 给最近弹出的那一个。
@MainActor
final class VoicePanelController: VoiceOverlayPresenting {
    static let width: CGFloat = 360
    /// 离屏幕可见区域底边的距离（在程序坞之上）。
    static let bottomInset: CGFloat = 96

    private let model: VoiceOverlayModel
    private let escape: EscapeRouter
    private var hosting: NSView?
    private var observation: Task<Void, Never>?
    var locale: () -> AppLocale = { .source }

    /// 语音浮层的窗口。正式浮层、静态预览与布局自检共用，免得三处各写一份样式与尺寸。
    static func makePanel(origin: CGPoint = .zero) -> NSPanel {
        NSPanel(contentRect: NSRect(origin: origin, size: CGSize(width: width, height: 120)),
                styleMask: [.titled, .fullSizeContentView, .nonactivatingPanel],
                backing: .buffered, defer: true)
    }

    /// 按内容定高：量 SwiftUI 内容的 `fittingSize`（宿主须以 `sizesToContent: true` 接入外壳，否则恒为 0 而被压成下限）。
    static func fittedHeight(_ hosting: NSView?) -> CGFloat {
        hosting?.layoutSubtreeIfNeeded()
        return max(hosting?.fittingSize.height ?? 120, 60)
    }

    private lazy var panel: NSPanel = {
        let panel = Self.makePanel()
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .utilityWindow
        hosting = FloatingPanelChrome.apply(to: panel, rootView: VoiceOverlayView(model: model), sizesToContent: true)
        return panel
    }()

    init(model: VoiceOverlayModel, escape: EscapeRouter) {
        self.model = model
        self.escape = escape
    }

    func show() {
        let locale = locale()
        if model.t.locale != locale { model.t = Translate(locale: locale) }
        let wasVisible = panel.isVisible
        fit(reposition: !wasVisible)
        if !wasVisible { panel.orderFrontRegardless() }
        escape.claim(.voice) { [weak self] in self?.model.onCancel?() }
        observeSize()
    }

    func hide() {
        observation?.cancel()
        observation = nil
        escape.release(.voice)
        if panel.isVisible { panel.orderOut(nil) }
    }

    /// 内容变了（换阶段、进度条出现）就按内容重新定高，底边不动。
    private func observeSize() {
        guard observation == nil else { return }
        observation = Task { [weak self] in
            while !Task.isCancelled {
                await withCheckedContinuation { continuation in
                    withObservationTracking {
                        guard let self else { return }
                        _ = self.model.phase
                        _ = self.model.models.state
                        _ = self.model.preparingEngine
                    } onChange: {
                        continuation.resume()
                    }
                }
                // 等 SwiftUI 把新内容排好再量
                try? await Task.sleep(for: .milliseconds(16))
                self?.fit(reposition: false)
            }
        }
    }

    private func fit(reposition: Bool) {
        let height = Self.fittedHeight(hosting)
        var frame = panel.frame
        if reposition {
            let mouse = NSEvent.mouseLocation
            let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
            let visible = screen?.visibleFrame ?? .zero
            frame.origin = CGPoint(x: visible.midX - Self.width / 2, y: visible.minY + Self.bottomInset)
        }
        frame.size = CGSize(width: Self.width, height: height)
        panel.setFrame(frame, display: true)
    }

}

/// 浮层内容。全部用系统控件、语义颜色与文字样式。
struct VoiceOverlayView: View {
    @Bindable var model: VoiceOverlayModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var t: Translate { model.t }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            VStack(alignment: .leading, spacing: 12) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .frame(width: VoicePanelController.width, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(isRecording ? Color.accentColor : Color.primary)
                .frame(width: 36, height: 36)
                .background(.fill.tertiary, in: Circle())
                .symbolEffect(.pulse, isActive: isRecording && !reduceMotion)
                .accessibilityHidden(true)
            Text(title).font(.headline).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            if isProcessing {
                ProgressView().controlSize(.small).accessibilityHidden(true) // 状态已由标题朗读
            }
            PanelButton(t("voice.close"), systemImage: "xmark") { model.onCancel?() }
                .floatingControl("voice.close")
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .idle, .cancelled:
            EmptyView()
        case .needsModel:
            VoiceModelSection(model: model)
        case .starting, .recording:
            VStack(alignment: .leading, spacing: 8) {
                if case .recording = model.phase, let since = model.recordingSince {
                    TimelineView(.periodic(from: since, by: 1)) { context in
                        Text(Self.elapsed(from: since, to: context.date))
                            .font(.title2.monospacedDigit())
                    }
                }
                Text(t("voice.recordingHint", ["hotkey": model.hotkeyLabel]))
                    .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .font(.callout)
        case .transcribing:
            if model.preparingEngine {
                Text(t("voice.preparingEngine")).font(.callout).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case let .postProcessing(transcript):
            ResultText(text: transcript).foregroundStyle(.secondary)
        case let .delivering(text, _):
            ResultText(text: text)
        case let .undelivered(text, _, reason):
            Text(t(Self.refusalKey(reason))).font(.callout).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            ResultText(text: text)
            HStack {
                copyButton(text)
                Spacer()
                Text(t("voice.escHint")).font(.callout).foregroundStyle(.secondary)
            }
        case let .done(text, _, truncated):
            if truncated {
                Text(t("voice.truncated")).font(.callout).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ResultText(text: text)
            HStack {
                copyButton(text)
                if truncated {
                    PanelButton(t("voice.retry"), bordered: true) { model.onRetry?() }
                }
                Spacer()
                Text(t("voice.escHint")).font(.callout).foregroundStyle(.secondary)
            }
        case let .failed(failure, transcript):
            // 页头已是警告图标，这里只放说明文字，不再叠一个红色警告符号
            Text(t(Self.messageKey(failure.kind))).font(.callout)
                .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            if failure.kind == .postProcess, !failure.detail.isEmpty {
                // Rust 给的具体原因（Key、网络、供应商……）
                ResultText(text: failure.detail, font: .callout).foregroundStyle(.secondary)
            }
            if let transcript {
                ResultText(text: transcript).foregroundStyle(.secondary)
                HStack {
                    copyButton(transcript, title: t("voice.copyTranscript"))
                    if failure.kind == .postProcess {
                        PanelButton(t("voice.retry"), bordered: true) { model.onRetry?() }
                    }
                }
            }
            if failure.kind == .micPermissionDenied {
                Button(t("voice.openMicSettings")) { model.onOpenMicSettings?() }
            }
        }
    }

    private var isRecording: Bool {
        if case .recording = model.phase { true } else { false }
    }

    private var isProcessing: Bool {
        switch model.phase {
        case .starting, .transcribing, .postProcessing, .delivering: true
        default: false
        }
    }

    private func copyButton(_ text: String, title: String? = nil) -> some View {
        PanelButton(model.copied ? t("voice.copied") : (title ?? t("voice.copy")),
                    systemImage: model.copied ? "checkmark" : "doc.on.doc", iconOnly: false, prominent: true) {
            model.onCopy?(text)
        }
        .floatingControl("voice.copy")
    }

    private var title: String {
        switch model.phase {
        case .idle, .cancelled: ""
        case .needsModel: t("voice.model.title")
        case .starting, .recording: t("voice.recording")
        case .transcribing: t("voice.transcribing")
        case .postProcessing: t(model.task == .translate ? "voice.translating" : "voice.postProcessing")
        case .done: t("voice.done")
        case .delivering: t("voice.delivering")
        case .undelivered: t("voice.undelivered")
        case .failed: t("voice.failed")
        }
    }

    private var symbol: String {
        switch model.phase {
        case .needsModel: "arrow.down.circle"
        case .starting, .recording: "mic.fill"
        case .transcribing, .postProcessing: "waveform"
        case .done, .delivering: "checkmark.circle"
        case .undelivered: "doc.on.clipboard"
        case .failed: "exclamationmark.triangle"
        case .idle, .cancelled: "mic"
        }
    }

    static func elapsed(from start: Date, to now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(start)))
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    /// 没交付的原因 → 文案 key。
    static func refusalKey(_ reason: VoiceDeliveryRefusal) -> String {
        switch reason {
        case .appChanged: "voice.undelivered.appChanged"
        case .focusChanged: "voice.undelivered.focusChanged"
        case .notEditable: "voice.undelivered.notEditable"
        case .secureInput: "voice.undelivered.secureInput"
        case .targetGone: "voice.undelivered.targetGone"
        case .unverifiable: "voice.undelivered.unverifiable"
        case .noPermission: "voice.undelivered.noPermission"
        case .failed: "voice.undelivered.failed"
        }
    }

    /// 错误类别 → 文案 key。
    static func messageKey(_ kind: VoiceErrorKind) -> String {
        switch kind {
        case .micPermissionDenied: "voice.error.micDenied"
        case .noInputDevice: "voice.error.noDevice"
        case .recording: "voice.error.recording"
        case .tooShort: "voice.error.tooShort"
        case .noSpeech: "voice.error.noSpeech"
        case .modelUnavailable: "voice.error.model"
        case .transcription: "voice.error.transcription"
        case .postProcess: "voice.error.postProcess"
        }
    }
}

/// 可选中、可滚动的结果文本。
private struct ResultText: View {
    let text: String
    var font: Font = .body

    var body: some View {
        ScrollView {
            Text(text)
                .font(font).lineSpacing(4)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(maxHeight: 160)
        .fixedSize(horizontal: false, vertical: true)
        .readingSurface()
    }
}

/// 首次使用：下载语音模型（PRD §7.4：进度、取消、错误与重试）。
private struct VoiceModelSection: View {
    @Bindable var model: VoiceOverlayModel

    private var t: Translate { model.t }
    private var store: VoiceModelStore { model.models }

    var body: some View {
        switch store.state {
        case .missing:
            Text(t("voice.model.needed", ["size": Self.megabytes(store.spec.sizeBytes)]))
                .fixedSize(horizontal: false, vertical: true)
            Button(t("voice.model.download")) { store.download() }
                .buttonStyle(.borderedProminent)
        case let .downloading(received, total):
            ProgressView(value: Double(received), total: Double(max(total, 1)))
            HStack {
                Text(t("voice.model.progress", ["received": Self.megabytes(received), "total": Self.megabytes(total)]))
                    .monospacedDigit().foregroundStyle(.secondary)
                Spacer()
                Button(t("common.cancel")) { store.cancel() }
            }
            .font(.callout)
        case .verifying:
            ProgressView().progressViewStyle(.linear)
            Text(t("voice.model.verifying")).font(.callout).foregroundStyle(.secondary)
        case .ready:
            Text(t("voice.model.ready", ["hotkey": model.hotkeyLabel])).fixedSize(horizontal: false, vertical: true)
        case let .failed(failure):
            Text(t(Self.failureKey(failure))).fixedSize(horizontal: false, vertical: true)
            Button(t("voice.model.retry")) { store.download() }
        }
    }

    static func megabytes(_ bytes: Int64) -> String {
        String(format: "%.0f MB", Double(bytes) / 1_048_576)
    }

    static func failureKey(_ failure: VoiceModelStore.Failure) -> String {
        switch failure {
        case .network: "voice.model.error.network"
        case .incomplete: "voice.model.error.incomplete"
        case .checksum: "voice.model.error.checksum"
        case .disk: "voice.model.error.disk"
        }
    }
}
