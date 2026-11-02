import Foundation
import Testing
@testable import Umuo

// 界面语言判定与取文案，外加 String Catalog 本身的一致性检查（key 集合、占位符）。

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

    @Test func 源语言是简体中文且保留核心入口文案() {
        #expect(catalog.sourceLanguage == "zh-Hans")
        // 核对当前用户任务，不用旧客户端的条目总数限制功能精简。
        for key in ["prefs.translate.selection", "prefs.translate.silent", "prefs.translate.compose",
                    "prefs.translate.ocr", "prefs.engine.apiKey", "panel.copy", "onboarding.seeDesc"] {
            #expect(catalog.entries[key] != nil, "缺少核心文案：\(key)")
        }
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

    @Test func 原生层抛给用户的每句话都有四语言文案() {
        // 平台层（取词、截图、写回、剪贴板、Keychain、开机启动）只带文案键往外抛，边界处按界面语言取。
        // 新增一种错误却忘了补文案的话，界面上会直接露出 key。
        let texts: [UserText] = [
            SelectionError.permissionDenied.text, SelectionError.noSelection.text,
            CaptureError.permissionDenied.text, ScreenOCR.permissionNotice, ScreenOCR.emptyNotice,
            ComposeRules.emptyText, ComposeRules.pasteNotBack,
            Keychain.Failure.status(-25300, .read).text, Keychain.Failure.status(-25300, .write).text,
            Keychain.Failure.status(-25300, .delete).text, Keychain.Failure.notUtf8.text,
            Autostart.checkLaunchPath("/Volumes/umuo/umuo.app/Contents/MacOS/umuo-desktop")!,
        ]
        let keys = texts.map(\.key) + HotkeyConflict.systemKeys + [
            "error.keyEventFailed", "error.selectionReadOnly", "error.fieldNotReplaceable", "error.selectionChanged",
            "error.fieldChanged", "error.writeRejected", "error.clipboardUnavailable", "error.copyFailed",
            "ocr.captureFailed", "ocr.recognizeFailed", "ocr.launchFailed", "ocr.tempDirFailed", "ocr.fileUnreadable",
            "ocr.invalidImage", "ocr.emptyImage", "ocr.visionFailed", "keychain.unavailable", "keychain.resaveKey",
            "autostart.writeFailed", "autostart.devBuild", "app.engineStarting", "app.engineFailed", "app.noHome",
            "prefs.settingsInvalid", "onboarding.modelWithProvider", "common.nothingToTranslate",
        ]
        for key in keys {
            #expect(catalog.entries[key]?.values.count == 4, "缺文案：\(key)")
        }
        #expect(HotkeyConflict.systemKeys.count == 13)
    }

    @Test func 读不到Key时提示去设置里重新保存() {
        #expect(Translate(locale: .zhCN)("keychain.resaveKey") == "凭据存储不可用：请在设置里重新保存 Key")
        for locale in AppLocale.allCases {
            #expect(!Translate(locale: locale)("keychain.resaveKey").contains("授权"), "没有授权入口，不该让用户去授权")
        }
    }

    @Test func 按语言取到对应的句子() {
        #expect(Translate(locale: .zhCN)("panel.copy") == "复制")
        #expect(Translate(locale: .en)("panel.copy") == "Copy")
        #expect(Translate(locale: .ja)("panel.copy") == "コピー")
    }

    @Test func 替换占位符() {
        #expect(Translate(locale: .zhCN)("panel.replaceFailed", ["reason": "目标已切换"]) == "替换失败：目标已切换")
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
