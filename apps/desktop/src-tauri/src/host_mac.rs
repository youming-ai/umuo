//! [`umuo_app::Host`] 的 macOS 实现：直接转给 `umuo-platform-macos`。

use umuo_platform::{SecretStore, SelectionReader};
use umuo_platform_macos::{MacSecretStore, MacSelection};

pub struct MacHost;

impl umuo_app::Host for MacHost {
    fn api_key(&self, provider_id: &str) -> Result<Option<String>, String> {
        MacSecretStore.get(provider_id).map_err(|e| e.to_string())
    }

    fn frontmost_app_name(&self) -> Option<String> {
        MacSelection.frontmost_app_name()
    }

    fn frontmost_app_token(&self) -> Option<String> {
        MacSelection.frontmost_app_token()
    }

    fn write_back(
        &self,
        source: umuo_app::host::FocusSource,
        original: &str,
        text: &str,
    ) -> Result<(), String> {
        MacSelection
            .replace_focus_text(focus_source(source), original, text)
            .map_err(|e| e.to_string())
    }
}

/// 取词得到的来源 → 应用层的同名枚举（应用层不依赖平台 crate）。
pub fn app_focus_source(source: umuo_platform::FocusSource) -> umuo_app::host::FocusSource {
    match source {
        umuo_platform::FocusSource::Selection => umuo_app::host::FocusSource::Selection,
        umuo_platform::FocusSource::WholeField => umuo_app::host::FocusSource::WholeField,
    }
}

/// 应用层的来源 → 平台层，写回时用。
fn focus_source(source: umuo_app::host::FocusSource) -> umuo_platform::FocusSource {
    match source {
        umuo_app::host::FocusSource::Selection => umuo_platform::FocusSource::Selection,
        umuo_app::host::FocusSource::WholeField => umuo_platform::FocusSource::WholeField,
    }
}
