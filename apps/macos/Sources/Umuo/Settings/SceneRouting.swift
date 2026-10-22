import Foundation

/// 一个「供应商 + 模型」。
struct ModelRef: Equatable, Sendable {
    var providerId: String
    var model: String

    /// 供应商与模型都填了才算配好（只填了一半的配置加载时只能被忽略，用户却以为配上了）。
    var isComplete: Bool {
        !providerId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// 可以单独配模型的场景（`settings.json` 的 `sceneModels` 里除 `compare` 之外的键）。
/// 顺序即设置页的展示顺序；`compare` 要的是**一组**模型，在对比那一段单独配。
enum SceneKey: String, CaseIterable, Sendable {
    case selection, compose, silentReplace, ocr, wordCard
}

/// 分场景模型（PRD §6.3）。
struct SceneModels: Equatable, Sendable {
    var scenes: [SceneKey: ModelRef] = [:]
    var compare: [ModelRef] = []
}

/// 分场景模型与备用顺序的编辑逻辑，`scene-routing.ts` 的移植。增删改都返回新值，「取消编辑」才做得到。
enum SceneRouting {
    /// 场景清单（设置页的展示顺序）。
    static let rows: [SceneKey] = SceneKey.allCases

    /// 设置某个场景的模型。没配好（含 nil）= 恢复「用默认模型」，不留只有供应商没有模型的中间态。
    static func set(_ models: SceneModels, _ key: SceneKey, to ref: ModelRef?) -> SceneModels {
        var next = models
        next.scenes[key] = ref.flatMap { $0.isComplete ? $0 : nil }
        return next
    }

    /// 显示用的一行文字。
    static func label(_ ref: ModelRef?, _ t: Translate) -> String {
        guard let ref, ref.isComplete else { return t("prefs.scene.useDefaultModel") }
        return "\(ref.providerId) · \(ref.model)"
    }

    /// 往备用顺序里加一条。没填完的、重复的一对都忽略：排两次只会在失败时白等一轮。
    static func addFallback(_ list: [ModelRef], _ ref: ModelRef) -> [ModelRef] {
        guard ref.isComplete, !list.contains(ref) else { return list }
        return list + [ref]
    }

    static func removeFallback(_ list: [ModelRef], at index: Int) -> [ModelRef] {
        list.enumerated().filter { $0.offset != index }.map(\.element)
    }

    /// 把备用顺序上移 / 下移（顺序就是重试顺序）。越界是无操作。
    static func moveFallback(_ list: [ModelRef], at index: Int, by delta: Int) -> [ModelRef] {
        let target = index + delta
        guard list.indices.contains(index), list.indices.contains(target) else { return list }
        return Reorder.move(list, from: index, to: target)
    }
}
