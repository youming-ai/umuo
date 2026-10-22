import SwiftUI

/// 引擎：自带 Key 的供应商、模型与分场景路由（`EnginePage.tsx`）。Key 的规则见 `EngineEditor`。
struct EnginePage: View {
    let model: SettingsModel
    @Bindable var engine: EngineEditor

    init(model: SettingsModel) {
        self.model = model
        engine = model.engine
    }

    private var p: Palette { model.palette }
    private var t: Translate { model.t }
    private var s: SettingsValues { model.values }

    var body: some View {
        let provider = model.provider
        VStack(alignment: .leading, spacing: 24) {
            Text(t("prefs.engine.intro")).font(.system(size: 12)).foregroundStyle(p.textTertiary.color)
                .padding(.horizontal, 4)

            PrefGroup(title: t("prefs.engine.default"), palette: p) {
                PrefRow(title: t("prefs.engine.provider"),
                        description: provider?.local == true ? t("prefs.engine.localHint") : nil, palette: p) {
                    PrefPicker(label: t("prefs.engine.provider"), value: model.providerId, options: model.providers.map {
                        ($0.id, $0.local ? t("prefs.engine.localLabel", ["name": $0.label]) : $0.label)
                    }) { engine.switchProvider($0) }
                }

                if let provider, provider.requiresKey {
                    PrefRow(title: t("prefs.engine.apiKey"),
                            description: model.keyConfigured == true ? t("prefs.engine.keyConfigured") : t("prefs.engine.keyMissing"),
                            error: engine.keyError, palette: p) {
                        SecureField(model.keyConfigured == true ? t("prefs.engine.keyKeep") : t("prefs.engine.keyPaste"),
                                    text: $engine.apiKey)
                            .textFieldStyle(.roundedBorder).frame(width: 180)
                            .accessibilityLabel(t("prefs.engine.apiKey"))
                        PrefButton(title: t("prefs.engine.keySave"), disabled: !engine.canSaveKey, palette: p) {
                            Task { await engine.saveKey() }
                        }
                        if model.keyConfigured == true {
                            PrefButton(title: t("prefs.engine.keyClear"), danger: true, palette: p) {
                                Task { await engine.clearKey() }
                            }
                        }
                    } extra: {
                        if !provider.keysUrl.isEmpty {
                            Button(t("prefs.engine.getKey", ["name": provider.label])) {
                                model.backend.openURL(provider.keysUrl)
                            }
                            .buttonStyle(.link).font(.system(size: 12))
                        }
                    }
                }

                if provider?.id == "azure" {
                    PrefRow(title: t("prefs.engine.azureEndpoint"), description: t("prefs.engine.azureEndpointHint"),
                            error: model.rowErrors["endpoint"], palette: p) {
                        DraftField(value: s.object("providerBaseUrls").string("azure"),
                                   placeholder: "https://<name>.openai.azure.com", width: 260) { url in
                            var urls = s.object("providerBaseUrls")
                            urls["azure"] = .string(url)
                            return model.commitRow("endpoint", ["providerBaseUrls": .object(urls)])
                        }
                    }
                }

                if provider?.id == "custom" {
                    PrefRow(title: t("prefs.engine.customBaseUrl"), description: t("prefs.engine.customBaseUrlHint"),
                            error: model.rowErrors["endpoint"], palette: p) {
                        DraftField(value: s.string("customBaseUrl"), placeholder: "https://gateway.internal/v1", width: 260) {
                            model.commitRow("endpoint", ["customBaseUrl": .string($0)])
                        }
                    }
                }

                PrefRow(title: t("prefs.engine.model"),
                        description: engine.modelNotice
                            ?? (provider?.id == "azure" ? t("prefs.engine.modelAzureHint") : t("prefs.engine.modelHint")),
                        error: model.rowErrors["model"], palette: p) {
                    DraftField(value: s.string("model"), placeholder: provider?.defaultModel ?? "", width: 180) {
                        model.commitRow("model", ["model": .string($0)])
                    }
                    // 下拉里的候选：拉到的模型列表，没拉过就是内置的推荐模型（Tauri 的 datalist）
                    let suggestions = engine.models.isEmpty ? (provider?.suggestedModels ?? []) : engine.models
                    if !suggestions.isEmpty {
                        Menu {
                            ForEach(suggestions, id: \.self) { name in
                                Button(name) { model.commitRow("model", ["model": .string(name)]) }
                            }
                        } label: { Image(systemName: "chevron.down") }
                            .menuStyle(.borderlessButton).fixedSize()
                            .accessibilityLabel(t("prefs.engine.model"))
                    }
                    PrefButton(title: t("prefs.engine.fetchModels"), palette: p) { Task { await engine.fetchModels() } }
                }
            }

            PrefGroup(palette: p) {
                PrefBlock(title: t("prefs.engine.routing"), description: t("prefs.engine.routingHint"), palette: p) {
                    SceneRoutingView(model: model, routing: model.routing)
                }
            }
        }
    }
}
