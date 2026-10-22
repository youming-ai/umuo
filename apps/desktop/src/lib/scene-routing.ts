/**
 * 分场景模型与备用顺序的编辑逻辑（PRD §6.3）。
 *
 * 增删改都返回新对象：设置页把整份 Settings 交给 `saveSettings`，
 * 原地改动会让 React 看不到变化，也会把「取消编辑」变成做不到的事。
 */

import type { Translate } from './i18n'
import type { ModelRef, SceneModels } from './ipc'

/** 可以单独配模型的场景。顺序即设置页的展示顺序。 */
export interface SceneRow {
  key: keyof Omit<SceneModels, 'compare'>
}

/**
 * 场景清单。
 *
 * `compare` 不在这里：它要的是**一组**模型而不是一个，在对比那一段单独配。
 */
export const SCENE_ROWS: SceneRow[] = [
  // 名字与说明在文案表里（prefs.scene.*），这里只定顺序。
  { key: 'selection' },
  { key: 'compose' },
  { key: 'silentReplace' },
  { key: 'ocr' },
  { key: 'wordCard' },
]

/**
 * 这条 `ModelRef` 是否已经填好（供应商与模型都要有）。
 *
 * 写成**类型谓词**而不是返回 `boolean`：调用处拿到 true 之后可以直接用 `ref.providerId`，
 * 否则每个使用点都要自己再判一次空。
 */
export function isComplete(ref: ModelRef | null): ref is ModelRef {
  return ref !== null && ref.providerId.trim() !== '' && ref.model.trim() !== ''
}

/**
 * 设置某个场景的模型。模型名清空 = 恢复「用默认模型」。
 *
 * 只清模型名而保留供应商是**不允许**的中间态：配置里出现一个没有模型的供应商，
 * 加载时只能被忽略，用户会以为自己配上了。
 */
export function setSceneModel(
  models: SceneModels,
  key: keyof Omit<SceneModels, 'compare'>,
  ref: ModelRef | null,
): SceneModels {
  return { ...models, [key]: isComplete(ref) ? ref : null }
}

/** 显示用的一行文字。 */
export function modelLabel(ref: ModelRef | null, t: Translate): string {
  return isComplete(ref) ? `${ref.providerId} · ${ref.model}` : t('prefs.scene.useDefaultModel')
}

function same(a: ModelRef, b: ModelRef): boolean {
  return a.providerId === b.providerId && a.model === b.model
}

/**
 * 往备用顺序里加一条。
 *
 * 重复项直接忽略：同一对（供应商 + 模型）排两次，只会在失败时白等一轮。
 */
export function addFallback(list: ModelRef[], ref: ModelRef): ModelRef[] {
  if (!isComplete(ref)) return list
  if (list.some((item) => same(item, ref))) return list
  return [...list, ref]
}

export function removeFallback(list: ModelRef[], index: number): ModelRef[] {
  return list.filter((_, i) => i !== index)
}

/** 把备用顺序上移/下移一位。顺序就是重试顺序，所以它得能调。 */
export function moveFallback(list: ModelRef[], index: number, delta: number): ModelRef[] {
  const target = index + delta
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}
