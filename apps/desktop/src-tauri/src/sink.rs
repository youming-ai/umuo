//! 应用层事件 → Tauri webview 事件。
//!
//! 线上格式与搬进 `umuo-app` 之前逐字节一致（下面的黄金快照守着）：
//! translate:// 事件在载荷外再套请求 id 与回译标记，compare:// 事件就是载荷本身。

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use umuo_app::event::{CompareEvent, CompareSink, Route, TranslateEvent, TranslateSink};

use crate::COMPARE_LABEL;

/// 每个 translate:// 事件都带上请求 id：前端只认自己正在显示的那一次，
/// 被顶掉的旧请求迟到的增量、错误一律丢掉（审查 H2 / M1）。
/// 用 flatten 而不是在五个载荷上各加两个字段：漏加一个，那个事件就会被前端当成
/// 「不属于当前请求」而丢掉，很难查。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Tagged<'a> {
    request_id: u64,
    back: bool,
    #[serde(flatten)]
    payload: &'a TranslateEvent,
}

fn tagged(route: Route, event: &TranslateEvent) -> Tagged<'_> {
    Tagged {
        request_id: route.request_id,
        back: route.back,
        payload: event,
    }
}

pub struct TauriSink(pub AppHandle);

impl TranslateSink for TauriSink {
    fn send(&self, route: Route, event: TranslateEvent) {
        let _ = self
            .0
            .emit_to(route.surface, event.name(), tagged(route, &event));
    }
}

impl CompareSink for TauriSink {
    fn send(&self, event: CompareEvent) {
        let _ = self.0.emit_to(COMPARE_LABEL, event.name(), &event);
    }
}

#[cfg(test)]
mod tests {
    //! 黄金快照：搬迁前用原来的类型实际序列化得到的 JSON，逐字节比对。
    //! 前端（`ipc.ts` 与各窗口的 reducer）依赖的就是这些字段名与结构。
    use super::*;
    use umuo_app::event::*;
    use umuo_core::error::{CoreError, SuggestedAction};

    const ROUTE: Route = Route {
        surface: "panel",
        request_id: 7,
        back: true,
    };

    fn translate(event: TranslateEvent) -> (&'static str, String) {
        (
            event.name(),
            serde_json::to_string(&tagged(ROUTE, &event)).unwrap(),
        )
    }

    fn compare(event: CompareEvent) -> (&'static str, String) {
        (event.name(), serde_json::to_string(&event).unwrap())
    }

    #[test]
    fn translate_events_keep_their_wire_format() {
        let cases = [
            (
                StartPayload {
                    text: "hi".into(),
                    provider: "OpenAI".into(),
                    model: "m".into(),
                    target_lang: "zh-CN".into(),
                    word_mode: false,
                    mode: "silentReplace",
                }
                .into(),
                "translate://start",
                r#"{"requestId":7,"back":true,"text":"hi","provider":"OpenAI","model":"m","targetLang":"zh-CN","wordMode":false,"mode":"silentReplace"}"#,
            ),
            (
                DeltaPayload { text: "你".into() }.into(),
                "translate://delta",
                r#"{"requestId":7,"back":true,"text":"你"}"#,
            ),
            (
                DonePayload {
                    warning: Some("w".into()),
                    model: "m".into(),
                    input_tokens: 1,
                    output_tokens: 2,
                    estimated: true,
                    cost_usd: Some(0.5),
                    first_token_ms: Some(3),
                    total_ms: 4,
                    replaced: true,
                    offline: false,
                }
                .into(),
                "translate://done",
                r#"{"requestId":7,"back":true,"warning":"w","model":"m","inputTokens":1,"outputTokens":2,"estimated":true,"costUsd":0.5,"firstTokenMs":3,"totalMs":4,"replaced":true,"offline":false}"#,
            ),
            (
                CardPayload {
                    word: "w".into(),
                    phonetic: Some("/w/".into()),
                    senses: vec![CardSense {
                        part_of_speech: "n.".into(),
                        definition: "d".into(),
                    }],
                    forms: vec!["ws".into()],
                    examples: vec![CardExample {
                        source: "s".into(),
                        target: "t".into(),
                    }],
                }
                .into(),
                "translate://card",
                r#"{"requestId":7,"back":true,"word":"w","phonetic":"/w/","senses":[{"partOfSpeech":"n.","definition":"d"}],"forms":["ws"],"examples":[{"source":"s","target":"t"}]}"#,
            ),
            (
                ErrorPayload {
                    message: "e".into(),
                    actions: CoreError::MissingKey.actions(),
                    needs_permission: true,
                    permission: Some("accessibility"),
                    source: Some("src".into()),
                }
                .into(),
                "translate://error",
                r#"{"requestId":7,"back":true,"message":"e","actions":["open_model_settings"],"needsPermission":true,"permission":"accessibility","source":"src"}"#,
            ),
        ];
        for (event, name, json) in cases {
            assert_eq!(translate(event), (name, json.to_string()));
        }
        let _ = SuggestedAction::OpenModelSettings;
    }

    #[test]
    fn compare_events_keep_their_wire_format() {
        let card = CompareCard {
            index: 1,
            provider_id: "openai".into(),
            provider: "OpenAI".into(),
            model: "m".into(),
        };
        let cases = [
            (
                CompareStartPayload {
                    run_id: 9,
                    text: "hi".into(),
                    target_lang: "ja".into(),
                    cards: vec![card],
                }
                .into(),
                "compare://start",
                r#"{"runId":9,"text":"hi","targetLang":"ja","cards":[{"index":1,"providerId":"openai","provider":"OpenAI","model":"m"}]}"#,
            ),
            (
                CompareDeltaPayload {
                    run_id: 9,
                    index: 1,
                    text: "x".into(),
                }
                .into(),
                "compare://delta",
                r#"{"runId":9,"index":1,"text":"x"}"#,
            ),
            (
                CompareDonePayload {
                    run_id: 9,
                    index: 1,
                    model: "m".into(),
                    total_ms: 5,
                    first_token_ms: None,
                    input_tokens: 1,
                    output_tokens: 2,
                    estimated: false,
                    cost_usd: None,
                    truncated: true,
                }
                .into(),
                "compare://done",
                r#"{"runId":9,"index":1,"model":"m","totalMs":5,"firstTokenMs":null,"inputTokens":1,"outputTokens":2,"estimated":false,"costUsd":null,"truncated":true}"#,
            ),
            (
                CompareErrorPayload {
                    run_id: 9,
                    index: 1,
                    message: "e".into(),
                }
                .into(),
                "compare://error",
                r#"{"runId":9,"index":1,"message":"e"}"#,
            ),
            (
                CompareNoticePayload {
                    run_id: 9,
                    message: "n".into(),
                }
                .into(),
                "compare://notice",
                r#"{"runId":9,"message":"n"}"#,
            ),
        ];
        for (event, name, json) in cases {
            assert_eq!(compare(event), (name, json.to_string()));
        }
    }
}
