import { describe, expect, it } from 'vitest'

import { tFor } from './i18n'

import {
  engineForLocalModel,
  engineForSavedKey,
  hasUsableEngine,
  isStepSatisfied,
  nextStep,
  type OnboardingState,
  prevStep,
  progressOf,
  STEPS,
  stepIndex,
} from './onboarding'

const fresh: OnboardingState = {
  targetLang: '',
  keyConfigured: false,
  localModelFound: false,
  accessibilityTrusted: false,
  screenRecordingGranted: false,
  practiced: false,
}

describe('步骤顺序', () => {
  it('五步，与 PRD §7.4 一一对应', () => {
    expect(STEPS.map((s) => s.id)).toEqual([
      'welcome',
      'languages',
      'model',
      'permissions',
      'practice',
    ])
  })

  it('每一步的标题都走文案表，界面语言切换后跟着变（审查 L24）', () => {
    const en = tFor('en')
    for (const step of STEPS) {
      // 文案表里缺这条时 t() 返回 key 本身
      expect(en(step.titleKey)).not.toBe(step.titleKey)
    }
    expect(en(STEPS[0].titleKey)).toBe('Welcome')
  })

  it('第一步没有上一步，最后一步没有下一步', () => {
    expect(prevStep('welcome')).toBeNull()
    expect(nextStep('practice')).toBeNull()
  })

  it('中间步骤前后都接得上', () => {
    expect(nextStep('welcome')).toBe('languages')
    expect(prevStep('permissions')).toBe('model')
    expect(stepIndex('practice')).toBe(4)
  })
})

describe('完成度', () => {
  it('刚装上时只有「欢迎」算完成', () => {
    // 欢迎页没有要填的东西，所以它天然是完成的——进度条不该从 0/5 开始，
    // 那看起来像是用户已经欠了五件事。
    expect(isStepSatisfied('welcome', fresh)).toBe(true)
    expect(progressOf(fresh)).toEqual({ done: 1, total: 5 })
  })

  it('选了目标语言就算完成语言这一步', () => {
    expect(isStepSatisfied('languages', { ...fresh, targetLang: 'zh-CN' })).toBe(true)
    expect(isStepSatisfied('languages', { ...fresh, targetLang: '   ' })).toBe(false)
  })

  it('配了 Key 或探测到本机模型都算完成模型这一步', () => {
    expect(isStepSatisfied('model', fresh)).toBe(false)
    expect(isStepSatisfied('model', { ...fresh, keyConfigured: true })).toBe(true)
    expect(isStepSatisfied('model', { ...fresh, localModelFound: true })).toBe(true)
  })

  it('权限这一步只认辅助功能，屏幕录制不影响完成', () => {
    // 屏幕录制只影响截图；因为用户暂时不想授权就卡住引导，是本末倒置。
    expect(isStepSatisfied('permissions', { ...fresh, screenRecordingGranted: true })).toBe(false)
    expect(isStepSatisfied('permissions', { ...fresh, accessibilityTrusted: true })).toBe(true)
  })

  it('翻过一次才算完成最后一步', () => {
    expect(isStepSatisfied('practice', { ...fresh, practiced: true })).toBe(true)
  })

  it('全部做完时是 5/5', () => {
    const done: OnboardingState = {
      targetLang: 'zh-CN',
      keyConfigured: true,
      localModelFound: false,
      accessibilityTrusted: true,
      screenRecordingGranted: true,
      practiced: true,
    }
    expect(progressOf(done)).toEqual({ done: 5, total: 5 })
  })
})

describe('有没有能用的引擎', () => {
  it('Key 与本机模型都没有时视为不可用', () => {
    // 这种情况下引导仍然可以结束，但界面要说清后果——否则用户以为客户端是坏的。
    expect(hasUsableEngine(fresh)).toBe(false)
  })

  it('任一存在即可用', () => {
    expect(hasUsableEngine({ ...fresh, keyConfigured: true })).toBe(true)
    expect(hasUsableEngine({ ...fresh, localModelFound: true })).toBe(true)
  })
})

describe('引导写进设置的默认引擎', () => {
  it('保存 Key 后首选换成这家，模型用它的默认模型', () => {
    expect(engineForSavedKey('anthropic', 'claude-3-5-haiku-latest')).toEqual({
      providerId: 'anthropic',
      model: 'claude-3-5-haiku-latest',
    })
  })

  it('只有本机模型时首选换成 Ollama 与探测到的模型', () => {
    expect(engineForLocalModel('qwen2.5:7b', { keyConfigured: false, requiresKey: true })).toEqual({
      providerId: 'ollama',
      model: 'qwen2.5:7b',
    })
  })

  it('首选已有 Key 时探测本机模型不改首选', () => {
    expect(engineForLocalModel('qwen2.5:7b', { keyConfigured: true, requiresKey: true })).toBeNull()
  })

  it('首选已是本机供应商时不覆盖用户挑的模型', () => {
    // 本机供应商不存 Key，keyStatus 永远是 false；从设置里重新打开引导时，
    // 不能因此把 llama3:70b 换成探测到的第一个模型。
    expect(
      engineForLocalModel('qwen2.5:7b', { keyConfigured: false, requiresKey: false }),
    ).toBeNull()
  })
})
