import SwiftUI

/// 权限：每一项都如实显示状态，并能「重新检查」——用户多半是从系统设置切回来的，
/// 窗口重新成为 key 时外层也会自动再查一次（`PermissionsPage.tsx`）。
///
/// 只有 Tauri 版的两项（辅助功能、屏幕录制）。连按修饰键要的「输入监控」没有单列：系统把辅助功能也算作可以监听，
/// 与 Tauri 版一致；麦克风也不在这里，现在没有任何功能用到它。
struct PermissionsPage: View {
    let model: SettingsModel

    var body: some View {
        let t = model.t
        Section {
            PermissionCard(model: model, title: t("prefs.permissions.accessibility"),
                           description: t("prefs.permissions.accessibilityHint"),
                           granted: model.permissions.accessibility) {
                PrefButton(title: t("prefs.permissions.openSettings")) {
                    model.backend.openSystemSettings(.accessibility)
                }
            }
        }
        Section {
            PermissionCard(model: model, title: t("prefs.permissions.screen"), description: t("prefs.permissions.screenHint"),
                           granted: model.permissions.screenRecording) {
                PrefButton(title: t("prefs.permissions.request")) {
                    Task {
                        await model.backend.requestScreenRecording()
                        await model.recheckPermissions()
                    }
                }
                PrefButton(title: t("prefs.permissions.openSettings")) {
                    model.backend.openSystemSettings(.screenRecording)
                }
            }
        }
    }
}

struct PermissionCard<Actions: View>: View {
    let model: SettingsModel
    let title: String
    let description: String
    let granted: Bool?
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        let t = model.t
        let state: (text: String, color: Color) = switch granted {
        case nil: (t("prefs.permissions.unknown"), Color.secondary)
        case true?: (t("prefs.permissions.granted"), Color.green)
        case false?: (t("prefs.permissions.missing"), Color.orange)
        }
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.headline).foregroundStyle(Color.primary)
                    Text(description).font(.callout).foregroundStyle(Color.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 6) {
                    Circle().fill(state.color).frame(width: 6, height: 6)
                    Text(state.text).font(.callout).foregroundStyle(state.color)
                }
                .accessibilityElement(children: .combine)
            }
            HStack(spacing: 8) {
                if granted != true { actions() }
                PrefButton(title: t("prefs.permissions.recheck")) { Task { await model.recheckPermissions() } }
            }
        }
        .padding(.vertical, 4)
    }
}
