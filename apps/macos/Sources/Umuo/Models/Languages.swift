import Foundation

/// 界面里可选的翻译语言。
///
/// 放在 Models 而不是设置页里：设置页的语言下拉与首次引导的第二步共用这一份。
/// 两处各写一份列表，迟早会出现「引导里选得到的语言，设置页里没有」。
enum Languages {
    static let all: [(code: String, label: String)] = [
        ("zh-CN", "简体中文"),
        ("zh-TW", "繁體中文"),
        ("en", "English"),
        ("ja", "日本語"),
        ("ko", "한국어"),
        ("fr", "Français"),
        ("de", "Deutsch"),
        ("es", "Español"),
        ("ru", "Русский"),
    ]

    /// 语言代码 → 显示名。认不出来就原样返回——总比显示空白强。
    static func label(_ code: String) -> String {
        all.first { $0.code == code }?.label ?? code
    }

    /// 设置里「界面语言」的选项。语言名用该语言自己写（通行做法），
    /// 只有「跟随系统」跟着界面语言走，由调用方换成 `prefs.followSystem`。
    static let uiLocales: [(value: String, label: String)] = [("system", "跟随系统")]
        + AppLocale.allCases.map { locale in (locale.rawValue, label(locale.rawValue)) }
}
