import { useState } from 'react'

import type { Translate } from '../lib/i18n'
import type { ModelRef, ProviderInfo, SceneModels, Settings } from '../lib/ipc'
import { isComplete, SCENE_ROWS, setSceneModel } from '../lib/scene-routing'
import { ModelRefList } from './ModelRefList'

/** 一个场景的可编辑草稿。供应商或模型为空都表示「跟随默认」。 */
const blank: ModelRef = { providerId: '', model: '' }

/**
 * 分场景模型与备用顺序（PRD §6.3）。
 *
 * 为什么用**本地草稿 + 失焦提交**而不是边打字边存：配置里不允许出现
 * 「选了供应商但模型名为空」的中间态（`setSceneModel` 会把它当成未配置丢弃），
 * 边打字边存会让输入框刚敲进去的内容立刻被清掉。
 */
export function SceneRouting({
  settings,
  providers,
  onUpdate,
  t,
}: {
  settings: Settings
  providers: ProviderInfo[]
  onUpdate: (patch: Partial<Settings>) => void
  t: Translate
}) {
  const [drafts, setDrafts] = useState<Record<string, ModelRef>>(() =>
    Object.fromEntries(SCENE_ROWS.map((row) => [row.key, settings.sceneModels[row.key] ?? blank])),
  )
  const commitScene = (key: keyof Omit<SceneModels, 'compare'>) => {
    onUpdate({ sceneModels: setSceneModel(settings.sceneModels, key, drafts[key] ?? blank) })
  }

  const patchDraft = (key: string, patch: Partial<ModelRef>) => {
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? blank), ...patch } }))
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {SCENE_ROWS.map((row) => {
          const draft = drafts[row.key] ?? blank
          return (
            <div key={row.key} className="flex items-center gap-2">
              <span
                className="w-28 shrink-0 truncate text-xs text-text-primary"
                title={t(SCENE_TEXT[row.key].hint)}
              >
                {t(SCENE_TEXT[row.key].label)}
              </span>
              <select
                aria-label={t('prefs.scene.provider', { scene: t(SCENE_TEXT[row.key].label) })}
                className="pref-select w-32 shrink-0"
                value={draft.providerId}
                onChange={(e) => patchDraft(row.key, { providerId: e.target.value })}
                onBlur={() => commitScene(row.key)}
              >
                <option value="">{t('prefs.scene.default')}</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
              <input
                aria-label={t('prefs.scene.model', { scene: t(SCENE_TEXT[row.key].label) })}
                className="pref-input min-w-0 flex-1"
                value={draft.model}
                placeholder={t('prefs.scene.modelPlaceholder')}
                spellCheck={false}
                onChange={(e) => patchDraft(row.key, { model: e.target.value })}
                onBlur={() => commitScene(row.key)}
              />
              <span className="w-4 shrink-0 text-center text-[11px] text-success">
                {isComplete(settings.sceneModels[row.key]) && (
                  <span
                    title={t('prefs.scene.custom')}
                    role="img"
                    aria-label={t('prefs.scene.custom')}
                  >
                    ●
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>

      <div className="space-y-2 pt-1">
        <p className="text-[13px] font-medium text-text-primary">{t('prefs.scene.fallback')}</p>
        <p className="text-xs text-text-tertiary">{t('prefs.scene.fallbackHint')}</p>
        <ModelRefList
          value={settings.fallbackModels}
          onChange={(fallbackModels) => onUpdate({ fallbackModels })}
          providers={providers}
          ordered
          t={t}
          emptyHint={t('prefs.scene.fallbackEmpty')}
        />
      </div>
    </div>
  )
}

const SCENE_TEXT = {
  selection: { label: 'prefs.scene.selection', hint: 'prefs.scene.selectionHint' },
  compose: { label: 'prefs.scene.compose', hint: 'prefs.scene.composeHint' },
  silentReplace: { label: 'prefs.scene.silentReplace', hint: 'prefs.scene.silentReplaceHint' },
  ocr: { label: 'prefs.scene.ocr', hint: 'prefs.scene.ocrHint' },
  wordCard: { label: 'prefs.scene.wordCard', hint: 'prefs.scene.wordCardHint' },
} as const
