/**
 * 设置窗的分区（左侧边栏）。
 *
 * 分区按「这件事在哪里发生」划分：通用偏好、翻译（各功能的快捷键与行为）、引擎（自带 Key
 * 与模型）、权限、高级（网络、用量、历史与隐私）、关于。听写、跟读、朗读、账号等分区
 * 等对应功能做出来再加——没有功能撑着的空页面只会让人觉得「坏了」。
 *
 * 权限没有单独的横幅：缺权限时「权限」分区点灯，并且打开设置窗时直接落在这一页。
 */

export type TabId = 'general' | 'translate' | 'engine' | 'permissions' | 'advanced' | 'about'

/** 顺序即侧边栏顺序。 */
export const TABS: TabId[] = ['general', 'translate', 'engine', 'permissions', 'advanced', 'about']

export interface AttentionInput {
  /** 当前供应商是否已配 Key。`null` = 还没读出来。 */
  keyConfigured: boolean | null
  /** 本月是否有供应商已经花到上限。 */
  someProviderOverLimit: boolean
  /** 是否缺少某项系统权限。`null` = 还没读出来。 */
  permissionMissing: boolean | null
}

/**
 * 哪几个分区需要提示。只在**真的需要用户动手**时点灯；读不出状态（`null`）时不点——
 * 一个因为读不到而亮的警示灯只会让人白跑一趟。
 */
export function tabAttention(input: AttentionInput): Partial<Record<TabId, boolean>> {
  const attention: Partial<Record<TabId, boolean>> = {}
  if (input.keyConfigured === false) attention.engine = true
  if (input.permissionMissing === true) attention.permissions = true
  if (input.someProviderOverLimit) attention.advanced = true
  return attention
}

/**
 * 打开设置窗时落在哪一页：没配 Key 的新用户先去「引擎」（不配什么都用不了），
 * 缺权限的去「权限」，其余从「通用」开始。
 */
export function initialTab(input: AttentionInput): TabId {
  if (input.keyConfigured === false) return 'engine'
  if (input.permissionMissing === true) return 'permissions'
  return 'general'
}
