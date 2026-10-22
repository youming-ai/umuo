import { useState } from 'react'

import type { Translate } from '../lib/i18n'
import type { ModelRef, ProviderInfo } from '../lib/ipc'
import {
  addFallback,
  isComplete,
  modelLabel,
  moveFallback,
  removeFallback,
} from '../lib/scene-routing'

const blank: ModelRef = { providerId: '', model: '' }

/**
 * 一串「供应商 + 模型」的编辑器。
 *
 * 抽出共用组件是因为**对比模型**与**备用顺序**是同一个形态：都是一组
 * `ModelRef`，都要能加、能删。差别只有一处——备用顺序的**顺序有意义**
 * （它就是重试顺序），所以那边多一对 ↑↓。
 *
 * 增删改的规则复用 `scene-routing` 里的纯函数：重复项忽略、没填完的不进列表。
 */
export function ModelRefList({
  value,
  onChange,
  providers,
  ordered = false,
  emptyHint,
  addLabel,
  t,
}: {
  value: ModelRef[]
  onChange: (next: ModelRef[]) => void
  providers: ProviderInfo[]
  /** 顺序是否有意义（有意义时显示 ↑↓）。 */
  ordered?: boolean
  emptyHint: string
  addLabel?: string
  t: Translate
}) {
  const [draft, setDraft] = useState<ModelRef>(blank)

  return (
    <div className="space-y-1">
      {value.length === 0 && <p className="text-[11px] text-text-tertiary">{emptyHint}</p>}
      <ul className="space-y-1">
        {value.map((ref, index) => (
          <li key={`${ref.providerId}:${ref.model}`} className="flex items-center gap-2">
            {ordered && <span className="text-[11px] text-text-muted">{index + 1}.</span>}
            <span className="text-xs text-text-primary">{modelLabel(ref, t)}</span>
            {ordered && (
              <>
                <button
                  type="button"
                  className="umuo-pressable ml-auto rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary"
                  onClick={() => onChange(moveFallback(value, index, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="umuo-pressable rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary"
                  onClick={() => onChange(moveFallback(value, index, 1))}
                >
                  ↓
                </button>
              </>
            )}
            <button
              type="button"
              className={[
                'umuo-pressable rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary',
                ordered ? '' : 'ml-auto',
              ].join(' ')}
              onClick={() => onChange(removeFallback(value, index))}
            >
              {t('prefs.modelList.remove')}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <select
          className="pref-select w-40 shrink-0"
          value={draft.providerId}
          onChange={(e) => setDraft({ ...draft, providerId: e.target.value })}
        >
          <option value="">{t('prefs.modelList.pickProvider')}</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
        <input
          className="pref-input min-w-0 flex-1"
          value={draft.model}
          placeholder={t('prefs.modelList.model')}
          spellCheck={false}
          onChange={(e) => setDraft({ ...draft, model: e.target.value })}
        />
        <button
          type="button"
          className="umuo-pressable shrink-0 rounded-control border border-border px-2 py-1 text-[11px] text-text-primary"
          onClick={() => {
            // 重复项会被 addFallback 忽略；不管加没加上都清空输入，
            // 否则用户会以为没生效而反复点。
            onChange(addFallback(value, draft))
            setDraft(blank)
          }}
          disabled={!isComplete(draft)}
        >
          {addLabel ?? t('prefs.modelList.add')}
        </button>
      </div>
    </div>
  )
}
