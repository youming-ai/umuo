/**
 * 首次启动引导的步骤与完成度（PRD §7.4，五步）。
 *
 * 只有「顺序」与「这一步算不算完成」是逻辑，其余都是渲染——所以这两件放在这里，
 * 有测试钉住。**引导不阻止用户前进**：权限可以稍后授予、模型可以稍后再配，
 * 把人卡在第四步只会让他卸载，而不是让他去系统设置里点一下。
 */

export type StepId = 'welcome' | 'languages' | 'model' | 'permissions' | 'practice'

export interface StepDef {
  id: StepId
  title: string
  hint: string
}

export const STEPS: StepDef[] = [
  { id: 'welcome', title: '欢迎', hint: 'umuo 是常驻菜单栏的系统级翻译客户端' },
  { id: 'languages', title: '语言', hint: '你主要翻译成哪种语言' },
  { id: 'model', title: '模型', hint: '自带 Key（BYOK），或直接用本机模型' },
  { id: 'permissions', title: '权限', hint: '取词需要辅助功能；截图需要屏幕录制' },
  { id: 'practice', title: '试一试', hint: '当场翻一句，看看浮窗长什么样' },
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
