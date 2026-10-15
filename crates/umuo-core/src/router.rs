//! 模型路由与故障转移（PRD §6.3）。
//!
//! 这一层**只做决策，不发请求**：给定场景、已配置的模型与失败原因，算出
//! 「下一个该试谁」或者「到此为止，把错误交给用户」。决策逻辑纯到可以直接单测，
//! 而真正的重试循环留在调用方（它才知道怎么取消、怎么把中间结果写进历史）。

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::wire::ModelRef;

/// 主模型超时时间（PRD §6.3 明确写了默认 8 s）。
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(8);

/// 一次对比最多发给几个模型（PRD §5.6：「最多 4 个」）。
///
/// 这个上限不是随手定的：对比是**并发**的，每个模型都是一次真实计费请求，
/// 而卡片横排超过 4 张之后已经读不过来，用户只会挑第一张。
pub const MAX_COMPARE_MODELS: usize = 4;

/// 从候选里选出参与对比的模型：去重、保序、截断到 [`MAX_COMPARE_MODELS`]。
///
/// 去重是必须的：同一家供应商的同名模型如果既出现在默认位置又出现在候选列表里，
/// 用户会看到两张一模一样的卡片，两边内容相同却各自计费一次。
pub fn compare_candidates(candidates: impl IntoIterator<Item = ModelRef>) -> Vec<ModelRef> {
    let mut chosen: Vec<ModelRef> = Vec::new();
    for candidate in candidates {
        if chosen.contains(&candidate) {
            continue;
        }
        if chosen.len() == MAX_COMPARE_MODELS {
            break;
        }
        chosen.push(candidate);
    }
    chosen
}

/// 使用场景。PRD §6.3 要求每个场景可以各配各的模型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Scene {
    /// 划词 / 划句翻译：要快。
    Selection,
    /// 撰写窗：可以慢一点，质量优先。
    Compose,
    /// 输入框原地替换：最快，用户正等着继续打字。
    SilentReplace,
    /// 截图 OCR 的识图 / 翻译。
    Ocr,
    /// 多模型对比：一次要发给多个，不接受再叠加故障转移。
    Compare,
    /// 单词词卡：要结构化输出。
    WordCard,
}

impl Scene {
    /// 这个场景是否允许故障转移。
    ///
    /// 对比场景刻意不允许：用户就是想看这几个模型各自的答案，
    /// 悄悄换掉其中一个会让对比结果失去意义。
    pub fn allows_failover(self) -> bool {
        self != Scene::Compare
    }
}

/// 分场景的模型配置（PRD §6.3，P1 功能，但数据结构现在就要定下来——
/// 后补会让配置文件的形状变更，进而要写迁移）。
// `rename_all` 与设置里其它字段保持一致。少了它，`settings.json` 里会混进
// `silent_replace` / `word_card` 这种 snake_case，而旁边全是 camelCase——
// 用户手改配置时极易写错。现在加是免费的（这个字段刚引入，没有既有配置），
// 以后加就是破坏性变更。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneModels {
    pub selection: Option<ModelRef>,
    pub compose: Option<ModelRef>,
    pub silent_replace: Option<ModelRef>,
    pub ocr: Option<ModelRef>,
    pub compare: Vec<ModelRef>,
    pub word_card: Option<ModelRef>,
}

impl SceneModels {
    /// 取某个场景专门配置的模型。
    pub fn get(&self, scene: Scene) -> Option<&ModelRef> {
        match scene {
            Scene::Selection => self.selection.as_ref(),
            Scene::Compose => self.compose.as_ref(),
            Scene::SilentReplace => self.silent_replace.as_ref(),
            Scene::Ocr => self.ocr.as_ref(),
            Scene::WordCard => self.word_card.as_ref(),
            // 对比场景没有「单个」模型，它有自己的列表。
            Scene::Compare => None,
        }
    }
}

/// 一次请求的模型候选顺序。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoutePlan {
    pub scene: Scene,
    /// 首选 + 备用，按尝试顺序排列。第一项永远优先。
    pub candidates: Vec<ModelRef>,
    pub timeout: Duration,
}

impl RoutePlan {
    pub fn primary(&self) -> Option<&ModelRef> {
        self.candidates.first()
    }
}

/// 排出一次请求的候选顺序。
///
/// 优先级：场景专用配置 > 默认模型 > 备用列表。备用列表里与首选重复的会被去掉，
/// 否则故障转移会拿着同一个模型再撞一次墙。
///
/// 刻意不叫 `plan`：测试里 `let plan = plan(...)` 会遮蔽函数名，
/// 让后续调用报出「expected function, found RoutePlan」这种与真实原因无关的错误。
pub fn build_plan(
    scene: Scene,
    default_model: Option<&ModelRef>,
    scene_models: &SceneModels,
    fallbacks: &[ModelRef],
) -> RoutePlan {
    let mut candidates: Vec<ModelRef> = Vec::new();

    let push = |candidate: Option<&ModelRef>, candidates: &mut Vec<ModelRef>| {
        if let Some(model) = candidate {
            if !candidates.iter().any(|c| c == model) {
                candidates.push(model.clone());
            }
        }
    };

    if scene == Scene::Compare {
        // 对比场景直接用用户挑的那组模型，不做「首选 + 备用」的语义。
        for model in &scene_models.compare {
            push(Some(model), &mut candidates);
        }
        return RoutePlan {
            scene,
            candidates,
            timeout: DEFAULT_TIMEOUT,
        };
    }

    push(scene_models.get(scene), &mut candidates);
    push(default_model, &mut candidates);
    if scene.allows_failover() {
        for fallback in fallbacks {
            push(Some(fallback), &mut candidates);
        }
    }

    RoutePlan {
        scene,
        candidates,
        timeout: DEFAULT_TIMEOUT,
    }
}

/// 第 `attempt` 次尝试失败后，是否还有下一个候选，以及它是谁。
///
/// 返回 `None` 的意思是「不要再试了，把错误交给用户」——这比返回一个注定失败的
/// 候选更重要：无意义的转移会把一次清晰失败变成 N 次日志噪音与更长的等待。
pub fn next_after_failure<'a>(
    plan: &'a RoutePlan,
    attempt: usize,
    error: &CoreError,
) -> Option<&'a ModelRef> {
    if !plan.scene.allows_failover() {
        return None;
    }
    if !error.is_failover_worthy() {
        return None;
    }
    plan.candidates.get(attempt + 1)
}

/// 一次尝试的结果，用于在结果卡片上标注「实际由哪个模型翻译」。
#[derive(Debug, Clone)]
pub struct Attempt {
    pub model: ModelRef,
    pub latency_ms: u64,
    pub error: Option<CoreError>,
}

/// 从尝试序列里挑出最终成功的那一次。
pub fn successful_attempt(attempts: &[Attempt]) -> Option<&Attempt> {
    attempts.iter().rev().find(|a| a.error.is_none())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(provider: &str, name: &str) -> ModelRef {
        ModelRef {
            provider_id: provider.to_string(),
            model: name.to_string(),
        }
    }

    #[test]
    fn scene_specific_model_wins_over_the_default() {
        let scene_models = SceneModels {
            silent_replace: Some(model("groq", "fast-model")),
            ..Default::default()
        };
        let default = model("openai", "gpt-4o-mini");
        let plan = build_plan(Scene::SilentReplace, Some(&default), &scene_models, &[]);
        assert_eq!(plan.primary().unwrap().model, "fast-model");

        // 其他场景没配专用模型，落回默认。
        let plan = build_plan(Scene::Selection, Some(&default), &scene_models, &[]);
        assert_eq!(plan.primary().unwrap().model, "gpt-4o-mini");
    }

    #[test]
    fn failover_candidates_are_appended_and_deduplicated() {
        let default = model("openai", "gpt-4o-mini");
        let fallbacks = vec![
            model("openai", "gpt-4o-mini"), // 与首选重复，必须去掉
            model("deepseek", "deepseek-chat"),
        ];
        let plan = build_plan(
            Scene::Selection,
            Some(&default),
            &SceneModels::default(),
            &fallbacks,
        );
        assert_eq!(plan.candidates.len(), 2, "重复候选应被去掉");
        assert_eq!(plan.candidates[1].model, "deepseek-chat");
    }

    #[test]
    fn rate_limit_moves_to_the_next_candidate() {
        let default = model("openai", "a");
        let plan = build_plan(
            Scene::Selection,
            Some(&default),
            &SceneModels::default(),
            &[model("deepseek", "b")],
        );
        let next = next_after_failure(&plan, 0, &CoreError::RateLimited { retry_after: None });
        assert_eq!(next.unwrap().model, "b");
    }

    #[test]
    fn invalid_key_does_not_waste_time_on_fallbacks() {
        // 备用模型用同一把 Key、同一个账号，换模型救不回来。
        let default = model("openai", "a");
        let plan = build_plan(
            Scene::Selection,
            Some(&default),
            &SceneModels::default(),
            &[model("deepseek", "b")],
        );
        assert!(next_after_failure(&plan, 0, &CoreError::InvalidKey).is_none());
        assert!(next_after_failure(&plan, 0, &CoreError::InsufficientBalance).is_none());
    }

    #[test]
    fn failover_stops_at_the_end_of_the_candidate_list() {
        let default = model("openai", "a");
        let plan = build_plan(
            Scene::Selection,
            Some(&default),
            &SceneModels::default(),
            &[model("deepseek", "b")],
        );
        let timeout = CoreError::Timeout {
            after: Duration::from_secs(8),
        };
        assert!(
            next_after_failure(&plan, 1, &timeout).is_none(),
            "没有第三个候选"
        );
    }

    #[test]
    fn compare_scene_never_fails_over() {
        // 对比的意义就是看这几个模型各自的答案，悄悄换掉一个会让结果失去意义。
        let scene_models = SceneModels {
            compare: vec![model("openai", "a"), model("anthropic", "b")],
            ..Default::default()
        };
        let plan = build_plan(Scene::Compare, None, &scene_models, &[model("x", "y")]);
        assert_eq!(plan.candidates.len(), 2);
        assert!(!plan.scene.allows_failover());
        assert!(
            next_after_failure(&plan, 0, &CoreError::RateLimited { retry_after: None }).is_none()
        );
    }

    #[test]
    fn the_model_that_actually_served_is_recoverable_for_the_result_card() {
        let attempts = vec![
            Attempt {
                model: model("openai", "a"),
                latency_ms: 8000,
                error: Some(CoreError::Timeout {
                    after: Duration::from_secs(8),
                }),
            },
            Attempt {
                model: model("deepseek", "b"),
                latency_ms: 900,
                error: None,
            },
        ];
        assert_eq!(successful_attempt(&attempts).unwrap().model.model, "b");
    }

    #[test]
    fn timeout_default_matches_the_prd() {
        assert_eq!(DEFAULT_TIMEOUT, Duration::from_secs(8));
        let plan = build_plan(
            Scene::Selection,
            Some(&model("openai", "a")),
            &SceneModels::default(),
            &[],
        );
        assert_eq!(plan.timeout, Duration::from_secs(8));
    }

    #[test]
    fn a_plan_with_no_configuration_yields_no_candidates_instead_of_a_fake_one() {
        let plan = build_plan(Scene::Selection, None, &SceneModels::default(), &[]);
        assert!(plan.primary().is_none());
    }

    #[test]
    fn compare_candidates_are_capped_at_four() {
        // PRD §5.6：「最多 4 个」。多出来的必须被丢掉，而不是全发出去。
        let many: Vec<ModelRef> = (0..8).map(|i| model("p", &format!("m{i}"))).collect();
        let chosen = compare_candidates(many);
        assert_eq!(chosen.len(), MAX_COMPARE_MODELS);
        assert_eq!(chosen[0].model, "m0", "应保留靠前的候选，而不是随机截断");
    }

    #[test]
    fn compare_candidates_deduplicate_because_each_card_costs_money() {
        // 同一家同名的两个候选会让用户看到两张一样的卡片，却各计费一次。
        let chosen = compare_candidates([
            model("openai", "gpt-4o-mini"),
            model("deepseek", "deepseek-chat"),
            model("openai", "gpt-4o-mini"),
        ]);
        assert_eq!(chosen.len(), 2);
    }

    #[test]
    fn compare_candidates_preserve_order_and_tolerate_an_empty_list() {
        let chosen = compare_candidates([model("a", "1"), model("b", "2"), model("c", "3")]);
        assert_eq!(
            chosen
                .iter()
                .map(|m| m.provider_id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b", "c"]
        );
        assert!(compare_candidates([]).is_empty());
    }
}
