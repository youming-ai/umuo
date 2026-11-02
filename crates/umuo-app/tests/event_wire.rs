//! 事件序列化的历史兼容快照；保留旧更新通道时代的契约作为回归证据。
use serde::Serialize;
use umuo_app::event::*;
use umuo_core::error::{CoreError, SuggestedAction};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Tagged<'a> {
    request_id: u64,
    #[serde(flatten)]
    payload: &'a TranslateEvent,
}

fn tagged(route: Route, event: &TranslateEvent) -> Tagged<'_> {
    Tagged {
        request_id: route.request_id,
        payload: event,
    }
}

const ROUTE: Route = Route {
    surface: "panel",
    request_id: 7,
};

fn translate(event: TranslateEvent) -> (&'static str, String) {
    (
        event.name(),
        serde_json::to_string(&tagged(ROUTE, &event)).unwrap(),
    )
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
            r#"{"requestId":7,"text":"hi","provider":"OpenAI","model":"m","targetLang":"zh-CN","wordMode":false,"mode":"silentReplace"}"#,
        ),
        (
            DeltaPayload { text: "你".into() }.into(),
            "translate://delta",
            r#"{"requestId":7,"text":"你"}"#,
        ),
        (
            DonePayload {
                warning: Some("w".into()),
                model: "m".into(),
                input_tokens: 1,
                output_tokens: 2,
                estimated: true,
                first_token_ms: Some(3),
                total_ms: 4,
                replaced: true,
            }
            .into(),
            "translate://done",
            r#"{"requestId":7,"warning":"w","model":"m","inputTokens":1,"outputTokens":2,"estimated":true,"firstTokenMs":3,"totalMs":4,"replaced":true}"#,
        ),
        (
            CardPayload {
                word: "w".into(),
                phonetic: Some("/w/".into()),
                senses: vec![CardSense {
                    part_of_speech: "n.".into(),
                    definition: "d".into(),
                }],
            }
            .into(),
            "translate://card",
            r#"{"requestId":7,"word":"w","phonetic":"/w/","senses":[{"partOfSpeech":"n.","definition":"d"}]}"#,
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
            r#"{"requestId":7,"message":"e","actions":["open_model_settings"],"needsPermission":true,"permission":"accessibility","source":"src"}"#,
        ),
        (
            ErrorPayload {
                message: "e".into(),
                actions: CoreError::Network {
                    message: "x".into(),
                }
                .actions(),
                needs_permission: false,
                permission: None,
                source: None,
            }
            .into(),
            "translate://error",
            r#"{"requestId":7,"message":"e","actions":["retry","check_network"],"needsPermission":false,"permission":null,"source":null}"#,
        ),
    ];
    for (event, name, json) in cases {
        assert_eq!(translate(event), (name, json.to_string()));
    }
    let _ = SuggestedAction::OpenModelSettings;
}
