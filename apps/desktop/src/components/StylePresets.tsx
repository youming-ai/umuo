import { useState } from 'react'

import type { Translate } from '../lib/i18n'
import type { CustomStyle, FewShotExample } from '../lib/ipc'
import {
  MAX_TEMPERATURE,
  newCustomStyle,
  parseTemperature,
  presetSummary,
  removeStyle,
  upsertStyle,
} from '../lib/style-presets'

/**
 * 自建风格预设的编辑器（PRD §5.7）。
 *
 * 抽成独立组件是因为设置页已经很长了，而这一块自带「列表 / 编辑中」两种状态。
 * 改动只落在本地 state 上，直到用户按「保存」才写回设置——否则每次敲键盘
 * 都会触发一次落盘，而中间状态（比如标签被清空）在 Rust 侧是会被校验拦下的。
 */
export function StylePresets({
  styles,
  selectedId,
  onSave,
  t,
}: {
  styles: CustomStyle[]
  selectedId: string
  onSave: (next: CustomStyle[]) => Promise<void>
  t: Translate
}) {
  const [editing, setEditing] = useState<CustomStyle | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = async (style: CustomStyle) => {
    const next = upsertStyle(styles, style)
    try {
      await onSave(next)
      setEditing(null)
      setError(null)
    } catch (failure) {
      // Rust 侧的校验失败（比如 id 撞上内置风格）要说出来，
      // 否则用户按了保存、编辑器也关了，却什么都没存上。
      setError(String(failure))
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm(t('prefs.presets.confirmDelete'))) return
    try {
      await onSave(removeStyle(styles, id))
      setError(null)
    } catch (failure) {
      setError(String(failure))
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-xs text-text-secondary">{t('prefs.presets.intro')}</p>
        <button
          type="button"
          className="umuo-pressable ml-auto rounded-control border border-border px-2 py-0.5 text-xs text-text-primary"
          onClick={() => {
            setError(null)
            setEditing(newCustomStyle())
          }}
        >
          {t('prefs.presets.new')}
        </button>
      </div>

      {error && <p className="text-xs text-error">{error}</p>}

      {styles.length === 0 && !editing && (
        <p className="text-xs text-text-tertiary">{t('prefs.presets.empty')}</p>
      )}

      {styles.length > 0 && (
        <ul className="space-y-1">
          {styles.map((style) => (
            <li key={style.id} className="flex items-center gap-2">
              <span className="text-xs text-text-primary">
                {style.label || t('prefs.presets.untitled')}
                {style.id === selectedId && (
                  <span className="ml-1 text-text-tertiary">{t('prefs.presets.inUse')}</span>
                )}
              </span>
              <span className="text-[11px] text-text-muted">{presetSummary(style, t)}</span>
              <button
                type="button"
                className="umuo-pressable ml-auto rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary"
                onClick={() => {
                  setError(null)
                  setEditing(style)
                }}
              >
                {t('prefs.presets.edit')}
              </button>
              <button
                type="button"
                className="umuo-pressable rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary"
                onClick={() => void remove(style.id)}
              >
                {t('prefs.presets.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <PresetEditor
          t={t}
          style={editing}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={() => void save(editing)}
        />
      )}
    </div>
  )
}

/**
 * few-shot 行的 key 来源。
 *
 * 不能用数组下标：用户在中间删掉一行时，下标会把后面几行的输入框状态错配给别的行。
 * 也不能用内容做 key：两条空行（用户刚点「加一条」）的内容完全一样，会撞 key。
 * 所以给每行一个会话内唯一的序号。
 */
let rowKeySeed = 0
function nextRowKey(): number {
  rowKeySeed += 1
  return rowKeySeed
}

function PresetEditor({
  t,
  style,
  onChange,
  onCancel,
  onSave,
}: {
  t: Translate
  style: CustomStyle
  onChange: (next: CustomStyle) => void
  onCancel: () => void
  onSave: () => void
}) {
  // 行 key 与 style.fewShot 一一对应，增删必须同步进行。
  const [rowKeys, setRowKeys] = useState(() => style.fewShot.map(() => nextRowKey()))

  const setExample = (index: number, patch: Partial<FewShotExample>) => {
    onChange({
      ...style,
      fewShot: style.fewShot.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    })
  }

  return (
    <div className="space-y-2 rounded-card border border-border bg-background p-3">
      <label className="block text-xs text-text-secondary">
        {t('prefs.presets.name')}
        <input
          className="mt-1 w-full rounded-control border border-border bg-background px-2 py-1 text-sm"
          value={style.label}
          placeholder={t('prefs.presets.namePlaceholder')}
          spellCheck={false}
          onChange={(e) => onChange({ ...style, label: e.target.value })}
        />
      </label>

      <label className="block text-xs text-text-secondary">
        {t('prefs.presets.instruction')}
        <textarea
          className="mt-1 h-20 w-full rounded-control border border-border bg-background px-2 py-1 text-sm"
          value={style.instruction}
          placeholder={t('prefs.presets.instructionPlaceholder')}
          spellCheck={false}
          onChange={(e) => onChange({ ...style, instruction: e.target.value })}
        />
        <span className="mt-1 block text-[11px] text-text-muted">
          {t('prefs.presets.variables')} <code>{'{source_lang}'}</code>{' '}
          <code>{'{target_lang}'}</code> <code>{'{glossary}'}</code> <code>{'{app_name}'}</code>
        </span>
      </label>

      <div className="flex items-center gap-4">
        <label className="text-xs text-text-secondary">
          {t('prefs.presets.temperature')}
          <input
            type="number"
            min={0}
            max={MAX_TEMPERATURE}
            step={0.1}
            className="ml-2 w-20 rounded-control border border-border bg-background px-2 py-1 text-sm"
            value={style.temperature}
            onChange={(e) => onChange({ ...style, temperature: parseTemperature(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={style.explain}
            onChange={(e) => onChange({ ...style, explain: e.target.checked })}
          />
          {t('prefs.presets.explain')}
        </label>
      </div>

      <div className="space-y-1">
        <p className="text-xs text-text-secondary">{t('prefs.presets.examples')}</p>
        {style.fewShot.map((example, index) => (
          <div key={rowKeys[index] ?? index} className="flex gap-1">
            <input
              className="flex-1 rounded-control border border-border bg-background px-2 py-1 text-xs"
              value={example.source}
              placeholder={t('prefs.presets.exampleSource')}
              spellCheck={false}
              onChange={(e) => setExample(index, { source: e.target.value })}
            />
            <input
              className="flex-1 rounded-control border border-border bg-background px-2 py-1 text-xs"
              value={example.target}
              placeholder={t('prefs.presets.exampleTarget')}
              spellCheck={false}
              onChange={(e) => setExample(index, { target: e.target.value })}
            />
            <button
              type="button"
              className="umuo-pressable rounded-control border border-border px-2 text-[11px] text-text-secondary"
              onClick={() => {
                setRowKeys(rowKeys.filter((_, i) => i !== index))
                onChange({
                  ...style,
                  fewShot: style.fewShot.filter((_, i) => i !== index),
                })
              }}
            >
              {t('prefs.presets.removeExample')}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="umuo-pressable rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary"
          onClick={() => {
            setRowKeys([...rowKeys, nextRowKey()])
            onChange({ ...style, fewShot: [...style.fewShot, { source: '', target: '' }] })
          }}
        >
          {t('prefs.presets.addExample')}
        </button>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className="umuo-pressable rounded-control border border-border bg-primary px-3 py-1 text-xs text-primary-foreground"
          onClick={onSave}
        >
          {t('prefs.presets.save')}
        </button>
        <button
          type="button"
          className="umuo-pressable rounded-control border border-border px-3 py-1 text-xs text-text-secondary"
          onClick={onCancel}
        >
          {t('prefs.presets.cancel')}
        </button>
      </div>
    </div>
  )
}
