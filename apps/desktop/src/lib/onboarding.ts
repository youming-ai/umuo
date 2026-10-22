/**
 * 首次启动引导的步骤与完成度（PRD §7.4，五步）。
 *
 * 只有「顺序」与「这一步算不算完成」是逻辑，其余都是渲染——所以这两件放在这里，
 * 有测试钉住。**引导不阻止用户前进**：权限可以稍后授予、模型可以稍后再配，
 * 把人卡在第四步只会让他卸载，而不是让他去系统设置里点一下。
 */

import type { MessageKey } from './i18n/messages'

export type StepId = 'welcome' | 'languages' | 'model' | 'permissions' | 'practice'

export interface StepDef {
  id: StepId
  /** 步骤标题在文案表里（审查 L24）：这里写死中文，其它界面语言的用户也只能看到中文。 */
  titleKey: MessageKey
}

export const STEPS: StepDef[] = [
  { id: 'welcome', titleKey: 'onboarding.step.welcome' },
  { id: 'languages', titleKey: 'onboarding.step.languages' },
  { id: 'model', titleKey: 'onboarding.step.model' },
  { id: 'permissions', titleKey: 'onboarding.step.permissions' },
  { id: 'practice', titleKey: 'onboarding.step.practice' },
]

export interface OnboardingState {
  /** 第一目标语言。 */
  targetLang: string
  /** 至少配了一把 Key。 */
  keyConfigured: boolean
  /** 探测到本机可用的 Ollama / LM Studio 模型。 */
  localModelFound: boolean
  accessibilityTrusted: boolean
  screenRecordingGranted: boolean
  /** 在引导里真的翻过一次。 */
  practiced: boolean
}

export function stepIndex(id: StepId): number {
  return STEPS.findIndex((step) => step.id === id)
}

export function nextStep(id: StepId): StepId | null {
  const index = stepIndex(id)
  return index >= 0 && index < STEPS.length - 1 ? STEPS[index + 1].id : null
}

export function prevStep(id: StepId): StepId | null {
  const index = stepIndex(id)
  return index > 0 ? STEPS[index - 1].id : null
}

/**
 * 这一步是否已经做完。
 *
 * 只用于**显示进度与提示**，不用于阻止前进——见模块顶部的说明。
 */
export function isStepSatisfied(id: StepId, state: OnboardingState): boolean {
  switch (id) {
    case 'welcome':
      return true
    case 'languages':
      return state.targetLang.trim() !== ''
    case 'model':
      return state.keyConfigured || state.localModelFound
    case 'permissions':
      // 辅助功能是取词的必需项；屏幕录制只影响截图，不阻塞这一步的完成。
      return state.accessibilityTrusted
    case 'practice':
      return state.practiced
  }
}

export interface Progress {
  done: number
  total: number
}

export function progressOf(state: OnboardingState): Progress {
  return {
    done: STEPS.filter((step) => isStepSatisfied(step.id, state)).length,
    total: STEPS.length,
  }
}

/**
 * 有没有一个「这次真能用」的引擎。
 *
 * 都没有时引导**仍然可以结束**，但要说清楚后果：客户端装上了却翻不了，
 * 用户会以为是坏的。
 */
export function hasUsableEngine(state: OnboardingState): boolean {
  return state.keyConfigured || state.localModelFound
}

/** 引导要写进设置的默认引擎（供应商 + 模型）。 */
export interface EngineChoice {
  providerId: string
  model: string
}

/**
 * 在引导里保存 Key 之后的默认引擎：首选换成这家，模型用它的默认模型。
 *
 * 只存 Key 不改首选的话，新用户填好 Anthropic 的 Key，第一次划词却仍走出厂的
 * OpenAI，报「缺少 Key」（审查 H6）。模型必须跟着换——沿用上一家的模型名会 404。
 */
export function engineForSavedKey(
  providerId: string,
  defaultModel: string | undefined,
): EngineChoice {
  return { providerId, model: defaultModel ?? '' }
}

/** 当前首选引擎此刻能不能用。 */
export interface PrimaryEngine {
  /** 首选供应商在钥匙串里有 Key。本机供应商永远是 `false`——它们不存 Key。 */
  keyConfigured: boolean
  /** 首选供应商需不需要 Key；Ollama / LM Studio 不需要。查不到供应商时按需要算。 */
  requiresKey: boolean
}

/**
 * 探测到本机模型后的默认引擎；`null` 表示不改。
 *
 * 首选已经能用时不抢：有 Key 的云端引擎是用户刚配好的，本机模型断网时本来
 * 就会被自动回落用上；首选本来就是本机供应商（从设置里重新打开引导的老用户），
 * 他自己挑的模型不能被探测到的第一个模型覆盖。
 */
export function engineForLocalModel(model: string, primary: PrimaryEngine): EngineChoice | null {
  const usable = primary.keyConfigured || !primary.requiresKey
  return usable ? null : { providerId: 'ollama', model }
}
