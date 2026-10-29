import SwiftUI

/// 引擎：自带 Key 的供应商与当前模型。Key 的规则见 `EngineEditor`。
struct EnginePage: View {
    let model: SettingsModel
    @Bindable var engine: EngineEditor

    init(model: SettingsModel) {
        self.model = model
        engine = model.engine
    }

    private var t: Translate { model.t }
    private var s: SettingsValues { model.values }

    var body: some View {
        let provider = model.provider
        Group {
            PrefGroup(title: t("prefs.engine.default")) {
                PrefRow(title: t("prefs.engine.provider"),
                        description: provider?.local == true ? t("prefs.engine.localHint") : nil) {
                    PrefPicker(label: t("prefs.engine.provider"), value: model.providerId, options: model.providers.map {
                        ($0.id, $0.local ? t("prefs.engine.localLabel", ["name": $0.label]) : $0.label)
                    }) { engine.switchProvider($0) }
                }

                if let provider, provider.requiresKey {
                    PrefRow(title: t("prefs.engine.apiKey"),
                            note: model.keyConfigured == true ? t("prefs.engine.keyConfigured") : t("prefs.engine.keyMissing"),
                            error: engine.keyError) {
                        SecureField(t("prefs.engine.apiKey"), text: $engine.apiKey,
                                    prompt: Text(model.keyConfigured == true ? t("prefs.engine.keyKeep") : t("prefs.engine.keyPaste")))
                            .textFieldStyle(.roundedBorder).labelsHidden().multilineTextAlignment(.leading).frame(width: 240)
                            .accessibilityLabel(t("prefs.engine.apiKey"))
                        PrefButton(title: t("prefs.engine.keySave"), disabled: !engine.canSaveKey) {
                            Task { await engine.saveKey() }
                        }
                        if model.keyConfigured == true {
                            PrefButton(title: t("prefs.engine.keyClear"), danger: true) {
                                Task { await engine.clearKey() }
                            }
                        }
                    } extra: {
                        if !provider.keysUrl.isEmpty {
                            Button(t("prefs.engine.getKey", ["name": provider.label])) {
                                model.backend.openURL(provider.keysUrl)
                            }
                            .buttonStyle(.link).font(.callout)
                        }
                    }
                }

                if provider?.id == "azure" {
                    PrefRow(title: t("prefs.engine.azureEndpoint"), description: t("prefs.engine.azureEndpointHint"),
                            error: model.rowErrors["endpoint"]) {
                        DraftField(value: s.object("providerBaseUrls").string("azure"),
                                   placeholder: "https://<name>.openai.azure.com", width: 280,
                                   label: t("prefs.engine.azureEndpoint")) { url in
                            var urls = s.object("providerBaseUrls")
                            urls["azure"] = .string(url)
                            return model.commitRow("endpoint", ["providerBaseUrls": .object(urls)])
                        }
                    }
                }

                if provider?.id == "custom" {
                    PrefRow(title: t("prefs.engine.customBaseUrl"), description: t("prefs.engine.customBaseUrlHint"),
                            error: model.rowErrors["endpoint"]) {
                        DraftField(value: s.string("customBaseUrl"), placeholder: "https://gateway.internal/v1", width: 280,
                                   label: t("prefs.engine.customBaseUrl")) {
                            model.commitRow("endpoint", ["customBaseUrl": .string($0)])
                        }
                    }
                }

                PrefRow(title: t("prefs.engine.model"),
                        description: provider?.id == "azure" ? t("prefs.engine.modelAzureHint") : t("prefs.engine.modelHint"),
                        note: engine.modelNotice,
                        error: model.rowErrors["model"]) {
                    // 系统组合框：能手填，下拉里是拉到的模型列表，没拉过就是内置的推荐模型（Tauri 的 datalist）
                    DraftField(value: s.string("model"), placeholder: provider?.defaultModel ?? "",
                               suggestions: engine.models.isEmpty ? (provider?.suggestedModels ?? []) : engine.models,
                               label: t("prefs.engine.model")) {
                        model.commitRow("model", ["model": .string($0)])
                    }
                    PrefButton(title: t("prefs.engine.fetchModels")) { Task { await engine.fetchModels() } }
                }
            }
        }
    }
}
