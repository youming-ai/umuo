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
            PermissionRow(t: t, title: t("prefs.permissions.accessibility"),
                          description: t("prefs.permissions.accessibilityHint"),
                          granted: model.permissions.accessibility) {
                PrefButton(title: t("prefs.permissions.openSettings")) {
                    model.backend.openSystemSettings(.accessibility)
                }
            }
            PermissionRow(t: t, title: t("prefs.permissions.screen"), description: t("prefs.permissions.screenHint"),
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
        Section {
            HStack {
                Spacer(minLength: 0)
                PrefButton(title: t("prefs.permissions.recheck")) { Task { await model.recheckPermissions() } }
            }
        }
    }
}

/// 一项权限，一行：名字与说明在左，右边是此刻的状态（系统的多色符号）与没授权时的操作按钮。
/// 设置窗与首次引导共用。
struct PermissionRow<Actions: View>: View {
    let t: Translate
    let title: String
    let description: String
    let granted: Bool?
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        LabeledContent {
            VStack(alignment: .trailing, spacing: 6) {
                PermissionStateLabel(t: t, granted: granted)
                if granted != true {
                    HStack(spacing: 8) { actions() }
                }
            }
            .fixedSize()
        } label: {
            Text(title)
            Text(description)
        }
    }
}

/// 权限状态：已授权是绿色对勾，未授权是黄色警告三角，还没读出来只有文字。
struct PermissionStateLabel: View {
    let t: Translate
    let granted: Bool?

    var body: some View {
        switch granted {
        case nil:
            Text(t("prefs.permissions.unknown")).foregroundStyle(Color.secondary)
        case true?:
            Label(t("prefs.permissions.granted"), systemImage: "checkmark.circle.fill").symbolRenderingMode(.multicolor)
        case false?:
            Label(t("prefs.permissions.missing"), systemImage: "exclamationmark.triangle.fill")
                .symbolRenderingMode(.multicolor)
        }
    }
}
