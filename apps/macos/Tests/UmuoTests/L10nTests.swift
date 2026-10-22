import Foundation
import Testing
@testable import Umuo

// i18n.test.ts 的语言判定与取文案，外加 String Catalog 本身的一致性检查（key 集合、占位符）。

@Suite("界面语言判定（PRD §8）")
struct ResolveLocaleTests {
    @Test func 明选的语言直接生效() {
        #expect(AppLocale.resolve(setting: "en", systemLanguages: ["zh-CN"]) == .en)
        #expect(AppLocale.resolve(setting: "ja", systemLanguages: []) == .ja)
        #expect(AppLocale.resolve(setting: "zh-TW", systemLanguages: ["en-US"]) == .zhTW)
    }

    @Test func 跟随系统时按系统语言猜() {
        #expect(AppLocale.resolve(setting: "system", systemLanguages: ["ja-JP", "en-US"]) == .ja)
        #expect(AppLocale.resolve(setting: "system", systemLanguages: ["en-GB"]) == .en)
    }

    @Test func 把繁体地区认成繁体而不是简体() {
        for tag in ["zh-Hant-TW", "zh-TW", "zh-HK", "zh-MO"] {
            #expect(AppLocale.resolve(setting: "system", systemLanguages: [tag]) == .zhTW, "\(tag)")
        }
        #expect(AppLocale.resolve(setting: "system", systemLanguages: ["zh-Hans-CN"]) == .zhCN)
        #expect(AppLocale.resolve(setting: "system", systemLanguages: ["zh-CN"]) == .zhCN)
    }

    @Test func 认不出来的偏好回落到源语言() {
        #expect(AppLocale.resolve(setting: "system", systemLanguages: ["ko-KR", "th-TH"]) == AppLocale.source)
        #expect(AppLocale.resolve(setting: "system", systemLanguages: []) == AppLocale.source)
    }

    @Test func 设置里写了不认识的值时当作跟随系统() {
        #expect(AppLocale.resolve(setting: "klingon", systemLanguages: ["en-US"]) == .en)
        #expect(AppLocale.resolve(setting: "", systemLanguages: ["ja"]) == .ja)
    }
}

@Suite("String Catalog")
struct CatalogTests {
    let catalog = StringCatalog.main

    @Test func 源语言是简体中文且与Tauri版同样多的条目() {
        #expect(catalog.sourceLanguage == "zh-Hans")
        // messages.ts + prefs-messages.ts 的简中 key 数（448），外加 SwiftUI 版新增的（设置窗 7 条、
        // 首次引导的本机模型探测 3 条、快捷面板打开窗口 2 条）；导出脚本重跑、或在 xcstrings 里加了条目，这里跟着改
        #expect(catalog.entries.count == 460)
    }

    @Test func 四种语言的key集合完全一致且没有空文案() {
        let codes = AppLocale.allCases.map(\.catalogCode)
        for (key, entry) in catalog.entries {
            #expect(Set(entry.values.keys) == Set(codes), "\(key) 的语言不全")
            for (code, value) in entry.values {
                #expect(!value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, "\(code) 的 \(key) 是空的")
            }
        }
    }

    @Test func 各语言的占位符一致且与名字表对得上() {
        // 少一个占位符会让错误信息断在半句话上。
        for (key, entry) in catalog.entries {
            let source = StringCatalog.placeholderIndexes(entry.values["zh-Hans"] ?? "")
            #expect(source == entry.names.indices.map { $0 + 1 }, "\(key) 的名字表与 %N$@ 不一致")
            for (code, value) in entry.values {
                #expect(StringCatalog.placeholderIndexes(value) == source, "\(code) 的 \(key) 占位符不一致")
                #expect(!value.contains("{"), "\(code) 的 \(key) 还有没换算的 {name}")
            }
        }
    }

    @Test func 按语言取到对应的句子() {
        #expect(Translate(locale: .zhCN)("panel.copy") == "复制")
        #expect(Translate(locale: .en)("panel.copy") == "Copy")
        #expect(Translate(locale: .ja)("panel.copy") == "コピー")
    }

    @Test func 替换占位符() {
        #expect(Translate(locale: .zhCN)("panel.replaceFailed", ["reason": "目标已切换"]) == "替换失败：目标已切换")
        #expect(Translate(locale: .en)("panel.switchingModel", ["provider": "DeepSeek"]) == "Retranslating with DeepSeek…")
    }

    @Test func 没给参数时保留占位符() {
        #expect(Translate(locale: .en)("panel.replaceFailed").contains("{reason}"))
    }

    @Test func 整个key都不存在时返回key本身() {
        #expect(Translate(locale: .en)("nope.missing") == "nope.missing")
    }

    @Test func 本语言缺这条时回落源语言() throws {
        let json = #"""
        {"sourceLanguage":"zh-Hans","version":"1.0","strings":{
          "a":{"comment":"placeholders: x, y","localizations":{
            "zh-Hans":{"stringUnit":{"state":"translated","value":"甲%1$@乙%2$@ 100%%"}},
            "en":{"stringUnit":{"state":"translated","value":"%2$@ then %1$@"}}}}}}
        """#
        let small = try StringCatalog(json: Data(json.utf8))
        #expect(small.string("a", locale: .ja, params: ["x": "1", "y": "2"]) == "甲1乙2 100%")
        // 英文的语序不同，按名字对位
        #expect(small.string("a", locale: .en, params: ["x": "1", "y": "2"]) == "2 then 1")
    }
}
