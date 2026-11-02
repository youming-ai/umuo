import Foundation

/// 设置窗的分区（左侧边栏）。
///
/// 分区按「这件事在哪里发生」划分：通用偏好、翻译（各功能的快捷键与行为）、引擎（自带 Key 与模型）、
/// 权限、高级（网络、历史与隐私）、关于。没有功能撑着的空页面只会让人觉得「坏了」，所以没有听写、账号这类分区。
///
/// 权限没有单独的横幅：缺权限时「权限」分区点灯，并且打开设置窗时直接落在这一页。
enum SettingsTab: String, CaseIterable, Sendable {
    case general, translate, engine, permissions, advanced, about

    /// 侧边栏标题的文案键。
    var titleKey: String { "prefs.tab.\(rawValue)" }

    /// 侧边栏图标（SF Symbols）。
    var symbol: String {
        switch self {
        case .general: "gearshape"
        case .translate: "character.bubble"
        case .engine: "cpu"
        case .permissions: "lock.shield"
        case .advanced: "slider.horizontal.3"
        case .about: "info.circle"
        }
    }
}

/// 决定哪些分区点灯、从哪一页开始的输入。nil = 还没读出来。
struct SettingsAttentionInput: Equatable, Sendable {
    /// 当前供应商是否已配 Key。
    var keyConfigured: Bool?
    /// 是否缺少某项系统权限。
    var permissionMissing: Bool?
}

enum SettingsTabs {
    /// 哪几个分区需要提示。只在**真的需要用户动手**时点灯；读不出状态（nil）时不点——
    /// 一个因为读不到而亮的警示灯只会让人白跑一趟。
    static func attention(_ input: SettingsAttentionInput) -> Set<SettingsTab> {
        var tabs = Set<SettingsTab>()
        if input.keyConfigured == false { tabs.insert(.engine) }
        if input.permissionMissing == true { tabs.insert(.permissions) }
        return tabs
    }

    /// 打开设置窗时落在哪一页：没配 Key 的新用户先去「引擎」（不配什么都用不了），缺权限的去「权限」，其余从「通用」开始。
    static func initial(_ input: SettingsAttentionInput) -> SettingsTab {
        if input.keyConfigured == false { return .engine }
        if input.permissionMissing == true { return .permissions }
        return .general
    }

    /// 是否缺权限：任一项**确定**没授权就算缺（哪怕另一项没读出来）；两项都确定已授权才算不缺；
    /// 其余（有读不出来的、但没有确定缺的）算「不知道」，不点灯。
    static func missingPermission(_ states: Bool?...) -> Bool? {
        if states.contains(false) { return true }
        if states.allSatisfy({ $0 == true }) { return false }
        return nil
    }
}
