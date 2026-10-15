/**
 * Rust 侧 IPC 的类型化封装。
 *
 * 这里是前端唯一能碰到系统的通道。注意 `keyStatus` 只回布尔值——
 * 明文 Key 永远不会从 Rust 流回 WebView（见 src-tauri/src/commands.rs 头部说明）。
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface Settings {
  providerId: string
  model: string
  targetLang: string
  secondaryTargetLang: string
  styleId: string
  selectionHotkey: string
  /** 输入框原地替换（静默翻译）的快捷键。 */
  silentReplaceHotkey: string
  /** 撰写窗的快捷键。 */
  composeHotkey: string
  /** 多模型对比的快捷键。 */
  compareHotkey: string
  /** 截图 OCR 的快捷键。 */
  ocrHotkey: string
  /** 静默 OCR（只复制原文）的快捷键。 */
  ocrSilentHotkey: string
  /** 自定义 OpenAI 兼容端点的 Base URL。只在选「自定义端点」时用。 */
  customBaseUrl: string
  /** 分场景模型；没配的场景回落到底部的默认模型。 */
  sceneModels: SceneModels
  /** 用户设定的备用顺序：首选超时 / 429 / 额度不足时依次重试。 */
  fallbackModels: ModelRef[]
  /** 用户自建的风格预设（PRD §5.7）。 */
  customStyles: CustomStyle[]
  /** 各供应商的月度费用上限。没列出的供应商 = 不设上限。 */
  monthlyLimits: ProviderLimit[]
  /** 超限之后怎么办。 */
  limitAction: LimitAction
  /** 参与对比的供应商 id。空数组 = 自动挑「已配置 Key 的供应商」。 */
  compareProviders: string[]
  /** 是否记录翻译历史。关掉之后一条都不写。 */
  historyEnabled: boolean
  /** 朗读选中文本快捷键（PRD §7.2）。 */
  speakHotkey: string
  /** 代理模式（PRD §8）：system（跟随系统）/ none（直连）/ custom。 */
  proxyMode: string
  /** 自定义代理地址。 */
  proxyUrl: string
  /** 目标语言规则（PRD §5.4）：fixed（固定）或 perApp（按 App 记忆）。 */
  targetLangMode: string
  /** 按 App 记住的目标语言：来源 App 名 → 语言码。只在 perApp 模式下生效。 */
  appTargetLangs: Record<string, string>
  /** 逐供应商的 Base URL 覆盖（Azure 必需填资源终结点）。 */
  providerBaseUrls: Record<string, string>
  /** 主题（PRD §7.3）：system / light / dark / highContrast。 */
  theme: string
  /** 界面语言（PRD §8）：system / zh-CN / zh-TW / en / ja。 */
  locale: string
  /** 菜单栏图标样式（PRD §7.3）：template / brand / black。 */
  trayIconStyle: string
  /** 取词黑名单（PRD §7.3）：这些应用里不读取选中文本。 */
  selectionBlacklist: string[]
  /** 母语（PRD §7.3 语言组）：源语言检测不出来时用它作为假设。空 = 不做假设。 */
  nativeLang: string
  /** 界面缩放（PRD §7.3 通用）：0.85 / 1 / 1.25 / 1.5。 */
  uiScale: number
  /** 开机启动（PRD §7.3）。 */
  launchAtLogin: boolean
  /** 历史保留天数。0 = 不自动清理。 */
  historyRetentionDays: number
  /** 隐私模式：开启期间一次翻译都不写入历史（临时状态，区别于长期的历史开关）。 */
  privacyMode: boolean
}

export interface ProviderInfo {
  id: string
  label: string
  defaultModel: string
  suggestedModels: string[]
  keysUrl: string
  requiresKey: boolean
  /** 必须由用户填 Base URL（Azure 的终结点、自定义端点）。 */
  requiresBaseUrl: boolean
  local: boolean
}

// ---------------------------------------------------------------- 模型路由（PRD §6.3）

/** 一次请求指向的「供应商 + 模型」。 */
export interface ModelRef {
  providerId: string
  model: string
}

/**
 * 分场景模型。空 = 该场景回落到底部选的默认模型。
 *
 * `compare` 是一组而不是一个：对比本来就要多个模型。
 */
export interface SceneModels {
  selection: ModelRef | null
  compose: ModelRef | null
  silentReplace: ModelRef | null
  ocr: ModelRef | null
  compare: ModelRef[]
  wordCard: ModelRef | null
}

// ---------------------------------------------------------------- 术语表（PRD §5.8）

export interface GlossaryEntry {
  source: string
  target: string
}

/** 一张术语表。按语言对生效；语言留空表示「不限」。 */
export interface Glossary {
  id: string
  name: string
  sourceLang: string
  targetLang: string
  entries: GlossaryEntry[]
}

/** 一条 few-shot 示例（PRD §5.7 的「示例」）。 */
export interface FewShotExample {
  source: string
  target: string
}

/** 用户自建的风格预设。字段与 Rust 的 `CustomStyle` 一一对应。 */
export interface CustomStyle {
  id: string
  label: string
  instruction: string
  temperature: number
  fewShot: FewShotExample[]
  explain: boolean
}

export interface StyleInfo {
  id: string
  label: string
  /** 是否用户自建（设置页据此决定能不能删）。 */
  custom: boolean
}

export interface StartPayload {
  text: string
  provider: string
  model: string
  targetLang: string
  wordMode: boolean
  /** `selection` = 只显示；`silentReplace` = 结果会写回原处。 */
  mode: TranslateMode
}

/** 与 Rust 侧 `translator::Mode::as_str` 一一对应，改了就是破坏性变更。 */
/**
 * 结果会往哪个窗口去。与 Rust 的 `Mode::as_str()` 一一对应。
 *
 * `ocr` 必须在这里：OCR 结果窗的原文**可编辑后重译**（PRD §5.5），
 * 而"这次是不是 OCR"正是靠它判断的——漏了它，那项功能就无处落脚。
 */
export type TranslateMode = 'selection' | 'silentReplace' | 'compose' | 'ocr'

/** 超限之后怎么办（PRD §5.10）。 */
export type LimitAction = 'warn' | 'failover'

/** 一条供应商月度上限（美元）。 */
export interface ProviderLimit {
  providerId: string
  limitUsd: number
}

export interface DonePayload {
  model: string
  inputTokens: number
  outputTokens: number
  estimated: boolean
  costUsd: number | null
  firstTokenMs: number | null
  totalMs: number
  /** 译文是否已经写回原处（静默翻译成功时为 true）。 */
  replaced: boolean
  /** 结果之外要说的一句话（目前只有月度上限用它）。 */
  warning: string | null
  /** 这次是离线用本机模型翻的（PRD §7.5）。 */
  offline: boolean
}

/** 与 Rust 的 `SuggestedAction` 一一对应（snake_case）。 */
export type SuggestedAction =
  | 'retry'
  | 'switch_model'
  | 'open_model_settings'
  | 'check_network'
  | 'use_local_model'

/** 需要用户去开的系统权限。截图与取词是两个**不同**的设置面板。 */
export type PermissionKind = 'accessibility' | 'screenRecording'

export interface ErrorPayload {
  message: string
  actions: SuggestedAction[]
  needsPermission: boolean
  permission: PermissionKind | null
}

// ---------------------------------------------------------------- 多模型对比（PRD §5.6）

export interface CompareCard {
  index: number
  providerId: string
  provider: string
  model: string
}

export interface CompareStart {
  text: string
  targetLang: string
  cards: CompareCard[]
}

export interface CompareDelta {
  index: number
  text: string
}

export interface CompareDone {
  index: number
  model: string
  totalMs: number
  firstTokenMs: number | null
  inputTokens: number
  outputTokens: number
  estimated: boolean
  costUsd: number | null
}

export interface CompareError {
  index: number
  message: string
}

// ---------------------------------------------------------------- 单词词卡（PRD §5.2）

export interface CardSense {
  partOfSpeech: string
  definition: string
}

export interface CardExample {
  source: string
  target: string
}

export interface WordCard {
  word: string
  phonetic: string | null
  senses: CardSense[]
  forms: string[]
  examples: CardExample[]
}

/** 一条被标记为「最佳」的偏好记录。 */
export interface Pick {
  providerId: string
  model: string
  count: number
}

// ---------------------------------------------------------------- 翻译历史（PRD §5.9）

export interface HistoryRecord {
  id: number
  createdAt: number
  sourceText: string
  translatedText: string
  sourceLang: string | null
  targetLang: string
  providerId: string
  model: string
  styleId: string
  scene: string
  sourceApp: string | null
  inputTokens: number
  outputTokens: number
  estimated: boolean
  costUsd: number | null
}

/** 历史检索条件（PRD §5.9）。三者可叠加。 */
export interface HistoryFilter {
  query?: string | null
  sourceApp?: string | null
  model?: string | null
}

/** 筛选下拉的候选值。 */
/** 快捷面板一次要用的全部状态（PRD §7.1）。 */
export interface QuickState {
  paused: boolean
  providerLabel: string
  model: string
  recent: QuickRecord[]
}

export interface QuickRecord {
  id: number
  source: string
  translation: string
  model: string
}

/** 导入配置的结果摘要。 */
export interface ImportSummary {
  providerId: string
  targetLang: string
  customStyleCount: number
  glossaryCount: number
  bundleVersion: number
}

/** 撰写窗的本次临时选择（PRD §5.3）。全部可选，空值 = 用设置里的默认。 */
export interface ComposeOverrides {
  sourceLang?: string | null
  targetLang?: string | null
  providerId?: string | null
  model?: string | null
  styleId?: string | null
}

export interface Facets {
  apps: string[]
  models: string[]
}

export interface Usage {
  count: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  /** 价格未知、未计入总额的条数。 */
  unpriced: number
}

/** 某一天的用量（PRD §5.10 的「按日展示」）。 */
export interface DayUsage {
  /** 本地日期，`YYYY-MM-DD`。 */
  day: string
  count: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  unpriced: number
}

/** 某个供应商在某段时间的用量。 */
export interface ProviderUsage {
  providerId: string
  count: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  unpriced: number
}

/** 一条收藏。`kind` 由 Rust 侧按词卡规则判定，前端不重复实现。 */
export interface Favorite {
  id: number
  createdAt: number
  kind: 'word' | 'sentence' | string
  text: string
  translation: string | null
  sourceLang: string | null
  targetLang: string | null
}

export const api = {
  getSettings: () => invoke<Settings>('get_settings'),
  /** 返回**规范化后**的设置（自建预设可能被修正），前端应当用它覆盖本地 state。 */
  saveSettings: (settings: Settings) => invoke<Settings>('save_settings', { settings }),
  providerCatalog: () => invoke<ProviderInfo[]>('provider_catalog'),
  styleCatalog: () => invoke<StyleInfo[]>('style_catalog'),
  keyStatus: (providerId: string) => invoke<boolean>('key_status', { providerId }),
  saveApiKey: (providerId: string, apiKey: string) =>
    invoke<void>('save_api_key', { providerId, apiKey }),
  deleteApiKey: (providerId: string) => invoke<void>('delete_api_key', { providerId }),
  listModels: (providerId: string) => invoke<string[]>('list_models', { providerId }),
  accessibilityTrusted: () => invoke<boolean>('accessibility_trusted'),
  openAccessibilitySettings: () => invoke<void>('open_accessibility_settings'),
  /** 屏幕录制是另一个设置面板，不能与辅助功能混用。 */
  openScreenRecordingSettings: () => invoke<void>('open_screen_recording_settings'),
  // 术语表（PRD §5.8）
  glossaryList: () => invoke<Glossary[]>('glossary_list'),
  /** 保存（新建或覆盖）一张表，返回保存后的全部表。 */
  glossarySave: (glossary: Glossary) => invoke<Glossary[]>('glossary_save', { glossary }),
  glossaryRemove: (id: string) => invoke<Glossary[]>('glossary_remove', { id }),
  /** 从 CSV / TSV 文本导入并**替换**该表条目，返回导入条数。 */
  glossaryImport: (id: string, text: string) => invoke<number>('glossary_import', { id, text }),
  /** 导出为 CSV 文本。 */
  glossaryExport: (id: string) => invoke<string>('glossary_export', { id }),

  /** 本月各供应商的花费（用于设置页显示「已用 / 上限」）。 */
  monthlySpend: () => invoke<ProviderUsage[]>('monthly_spend'),
  // 浮窗的操作（PRD §5.2）
  /** 菜单栏快捷面板（PRD §7.1）：一次取回面板要用的全部状态。 */
  quickState: () => invoke<QuickState>('quick_state'),
  /** 暂停 / 恢复全局快捷键。返回切换后的状态。 */
  setPaused: (paused: boolean) => invoke<boolean>('set_paused', { paused }),
  /** 快捷面板里点「翻译」：走与 ⌥D 相同的流水线并收起面板。 */
  quickTranslate: (text: string) => invoke<void>('quick_translate', { text }),

  /** 注册时被系统拒绝的快捷键（按功能名）。PRD §7.2 的冲突提示。 */
  hotkeyFailures: () => invoke<string[]>('hotkey_failures'),
  /** 设置窗录快捷键期间暂停全局快捷键（Rust 侧 30 秒后自动失效）。 */
  setHotkeyRecording: (active: boolean) => invoke<void>('set_hotkey_recording', { active }),

  /** 客户端版本号（关于页）。由 Rust 侧提供，避免前端写死后与打包版本不一致。 */
  appVersion: () => invoke<string>('app_version'),

  /** 开机启动（PRD §7.3 通用）。 */
  autostartStatus: () => invoke<boolean>('autostart_status'),
  setAutostart: (enabled: boolean) => invoke<boolean>('set_autostart', { enabled }),

  /** 配置导入导出（PRD §6.4）。导出返回写出的完整路径。 */
  exportConfig: () => invoke<string>('export_config'),
  importConfig: (path: string) => invoke<ImportSummary>('import_config', { path }),

  /** 首次启动引导（PRD §7.4）。 */
  openOnboarding: () => invoke<void>('open_onboarding'),
  finishOnboarding: () => invoke<void>('finish_onboarding'),

  /** 已配好 Key、这次真能用的供应商（浮窗的「换个模型」用）。 */
  configuredProviders: () => invoke<ProviderInfo[]>('configured_providers'),
  /** 同一段原文，换供应商 / 模型 / 风格重译（只影响这一次，不改设置）。 */
  retranslate: (
    text: string,
    providerId?: string | null,
    model?: string | null,
    styleId?: string | null,
    /** 保住 ocr 模式，OCR 结果窗的原文才继续可编辑（PRD §5.5）。 */
    mode?: string | null,
  ) => invoke<void>('retranslate', { text, providerId, model, styleId, mode }),
  /** 把译文替换回源应用。写不进去时返回原因（用户切走了、目标不可写等）。 */
  replaceSource: (text: string) => invoke<void>('replace_source', { text }),
  /** 把原文（可带译文）带到撰写窗。 */
  openComposeWith: (text: string, translation: string | null) =>
    invoke<void>('open_compose_with', { text, translation }),

  /** 浮窗是否被钉住（钉住后切走也不自动收起）。 */
  panelPinned: () => invoke<boolean>('panel_pinned'),
  /** 切换钉住，返回切换后的状态。 */
  panelSetPinned: (pinned: boolean) => invoke<boolean>('panel_set_pinned', { pinned }),

  /** 朗读文本。语言由 Rust 侧推断，前端不传。 */
  speakText: (text: string) => invoke<void>('speak_text', { text }),
  stopSpeaking: () => invoke<void>('stop_speaking'),
  ocrPermission: () => invoke<boolean>('ocr_permission'),
  ocrRequestPermission: () => invoke<boolean>('ocr_request_permission'),
  /** 走 Rust 侧的剪贴板，而不是 navigator.clipboard——WebView 的剪贴板权限在打包后并不总是可用。 */
  copyText: (text: string) => invoke<void>('copy_text', { text }),
  translateText: (text: string) => invoke<void>('translate_text', { text }),
  cancelTranslation: () => invoke<void>('cancel_translation'),
  hidePanel: () => invoke<void>('hide_panel'),
  openSettings: () => invoke<void>('open_settings'),
  openExternal: (url: string) => invoke<void>('open_external', { url }),

  // 撰写窗（PRD §5.3）
  toggleCompose: () => invoke<void>('toggle_compose'),
  hideCompose: () => invoke<void>('hide_compose'),
  /**
   * 撰写窗的翻译。`overrides` 是**本次撰写**的语言/模型/风格选择，
   * 不写回设置——用户在撰写窗试一下别的风格，不该改掉默认风格。
   */
  composeTranslate: (text: string, overrides: ComposeOverrides = {}) =>
    invoke<void>('compose_translate', {
      text,
      sourceLang: null,
      targetLang: null,
      providerId: null,
      model: null,
      styleId: null,
      ...overrides,
    }),
  composeBackTranslate: (sourceText: string, translatedText: string) =>
    invoke<void>('compose_back_translate', { sourceText, translatedText }),
  /** `paste` = true 对应 ⌘⇧Enter：复制并粘贴回上一个 App。 */
  composeCommit: (text: string, paste: boolean) => invoke<void>('compose_commit', { text, paste }),

  // 多模型对比（PRD §5.6）
  compareTranslate: (text: string) => invoke<void>('compare_translate', { text }),
  hideCompare: () => invoke<void>('hide_compare'),
  /** 记一次「选它」，返回更新后的完整排行。 */
  recordComparePick: (providerId: string, model: string) =>
    invoke<Pick[]>('record_compare_pick', { providerId, model }),
  comparePicks: () => invoke<Pick[]>('compare_picks'),

  // 翻译历史（PRD §5.9）
  openHistory: () => invoke<void>('open_history'),
  /** 按条件查询历史；空条件等于「显示全部」。三个条件是 AND。 */
  historyQuery: (filter: HistoryFilter, limit: number, offset: number) =>
    invoke<HistoryRecord[]>('history_query', { filter, limit, offset }),
  /** 筛选下拉的候选值：历史里真正出现过的来源 App 与模型。 */
  historyFacets: () => invoke<Facets>('history_facets'),
  historyDelete: (id: number) => invoke<boolean>('history_delete', { id }),
  historyClear: () => invoke<number>('history_clear'),
  usageSummary: () => invoke<Usage>('usage_summary'),
  usageDaily: (days: number) => invoke<DayUsage[]>('usage_daily', { days }),

  // 收藏（PRD §5.9）
  /** 切换收藏，返回切换后的状态。 */
  favoriteToggle: (text: string, translation: string | null) =>
    invoke<boolean>('favorite_toggle', { text, translation }),
  /** 一次问完一批文本的收藏状态，避免逐行 IPC。 */
  favoritesStatus: (texts: string[]) => invoke<boolean[]>('favorites_status', { texts }),
  favoritesList: (limit: number, offset: number) =>
    invoke<Favorite[]>('favorites_list', { limit, offset }),
  favoriteRemove: (id: number) => invoke<boolean>('favorite_remove', { id }),
}

/** 订阅对比窗的四个事件，返回统一的反订阅函数。 */
/** 快捷键重注册完成（设置里改了快捷键、或录键结束）。设置窗据此重新读注册失败清单。 */
export function onHotkeysRegistered(handler: () => void): Promise<UnlistenFn> {
  return listen('hotkeys://registered', () => handler())
}

export async function onCompareEvents(handlers: {
  onStart: (payload: CompareStart) => void
  onDelta: (payload: CompareDelta) => void
  onDone: (payload: CompareDone) => void
  onError: (payload: CompareError) => void
}): Promise<UnlistenFn> {
  const unlisteners = await Promise.all([
    listen<CompareStart>('compare://start', (e) => handlers.onStart(e.payload)),
    listen<CompareDelta>('compare://delta', (e) => handlers.onDelta(e.payload)),
    listen<CompareDone>('compare://done', (e) => handlers.onDone(e.payload)),
    listen<CompareError>('compare://error', (e) => handlers.onError(e.payload)),
  ])
  return () => {
    for (const unlisten of unlisteners) unlisten()
  }
}

/** 订阅浮窗需要的四个事件，返回一个统一的反订阅函数。 */
/**
 * 撰写窗的预填事件（浮窗的「在撰写窗打开」，PRD §5.2）。
 *
 * 与翻译事件分开是因为它只在撰写窗里用，而且**不是**一次翻译的结果。
 */
/**
 * 主题变更广播（PRD §7.3）。
 *
 * 设置窗改了主题后，其它窗口（尤其是常驻的浮窗）要立刻跟着变——
 * 不广播的话用户会以为"没生效"，一直等到下次重启。
 */
export async function onThemeChanged(handler: (theme: string) => void): Promise<UnlistenFn> {
  return listen<string>('settings://theme', (event) => handler(event.payload))
}

/** 界面缩放变更广播（PRD §7.3 通用）。 */
export async function onScaleChanged(handler: (scale: number) => void): Promise<UnlistenFn> {
  return listen<number>('settings://scale', (event) => handler(event.payload))
}

/** 界面语言变更广播（PRD §8）。与主题同理：浮窗常驻，要立刻跟着变。 */
export async function onLocaleChanged(handler: (locale: string) => void): Promise<UnlistenFn> {
  return listen<string>('settings://locale', (event) => handler(event.payload))
}

export async function onComposePrefill(
  handler: (payload: { text: string; translation: string | null }) => void,
): Promise<UnlistenFn> {
  return listen<{ text: string; translation: string | null }>('compose://prefill', (event) =>
    handler(event.payload),
  )
}

export async function onTranslationEvents(handlers: {
  onStart: (payload: StartPayload) => void
  onDelta: (text: string) => void
  onCard: (payload: WordCard) => void
  onDone: (payload: DonePayload) => void
  onError: (payload: ErrorPayload) => void
}): Promise<UnlistenFn> {
  const unlisteners = await Promise.all([
    listen<StartPayload>('translate://start', (e) => handlers.onStart(e.payload)),
    listen<{ text: string }>('translate://delta', (e) => handlers.onDelta(e.payload.text)),
    listen<WordCard>('translate://card', (e) => handlers.onCard(e.payload)),
    listen<DonePayload>('translate://done', (e) => handlers.onDone(e.payload)),
    listen<ErrorPayload>('translate://error', (e) => handlers.onError(e.payload)),
  ])
  return () => {
    for (const unlisten of unlisteners) unlisten()
  }
}
