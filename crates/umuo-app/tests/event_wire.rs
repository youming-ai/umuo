//! 事件序列化的历史兼容快照；保留旧更新通道时代的契约作为回归证据。
use serde::Serialize;
use umuo_app::event::*;
use umuo_core::error::{CoreError, SuggestedAction};

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
