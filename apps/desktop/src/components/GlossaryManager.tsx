import { useCallback, useEffect, useState } from 'react'
import { glossarySummary, newGlossary } from '../lib/glossary-editor'
import type { Translate } from '../lib/i18n'
import { api, type Glossary } from '../lib/ipc'

/**
 * 术语表管理（PRD §5.8）。
 *
 * 刻意**用「粘贴 CSV」而不是逐行表格编辑器**：用户真正的术语来源是
 * Excel / Numbers / 厂商给的术语表，都是复制粘贴进来或存成 CSV 的。
 * 逐行编辑器又长又难用，而粘贴框一步到位——解析与引号规则在 Rust 侧
 * （`glossary::parse_delimited`），前端不重复实现一遍。
 */
export function GlossaryManager({ t }: { t: Translate }) {
  const [lists, setLists] = useState<Glossary[]>([])
  const [editing, setEditing] = useState<Glossary | null>(null)
  const [csv, setCsv] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const next = await api.glossaryList()
      setLists(next)
      // 打开编辑框时把该表现有条目反填成 CSV，用户可以就地改。
      setEditing((current) => (current ? (next.find((l) => l.id === current.id) ?? null) : null))
    } catch (error) {
      setStatus(t('prefs.glossary.loadFailed', { reason: String(error) }))
    }
  }, [t])

  useEffect(() => {
    void reload()
  }, [reload])

  const startEditing = (list: Glossary) => {
    setStatus(null)
    setEditing(list)
    setCsv(list.entries.map((e) => `${e.source}\t${e.target}`).join('\n'))
  }

  const save = async (list: Glossary, text: string | null) => {
    try {
      // 先存表本身（名称、语言对），再导入条目——两步分开是因为导入失败时
      // 用户不该连表名都丢掉。
      await api.glossarySave(list)
      if (text !== null) {
        const count = await api.glossaryImport(list.id, text)
        setStatus(t('prefs.glossary.savedWithCount', { name: list.name, count }))
      } else {
        setStatus(t('prefs.glossary.saved', { name: list.name }))
      }
      await reload()
      setEditing(null)
    } catch (error) {
      setStatus(String(error))
    }
  }

  const remove = async (list: Glossary) => {
    if (!window.confirm(t('prefs.glossary.confirmDelete', { name: list.name }))) return
    try {
      setLists(await api.glossaryRemove(list.id))
      setStatus(t('prefs.glossary.deleted', { name: list.name }))
    } catch (error) {
      setStatus(String(error))
    }
  }

  const copyCsv = async (list: Glossary) => {
    try {
      // 导出成 CSV 再放进剪贴板：用户可以直接存成文件交给同事。
      await api.copyText(await api.glossaryExport(list.id))
      setStatus(t('prefs.glossary.copied'))
    } catch (error) {
      setStatus(String(error))
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <p className="text-xs text-text-secondary">{t('prefs.glossary.intro')}</p>
        <button
          type="button"
          className="umuo-pressable ml-auto shrink-0 rounded-control border border-border px-2 py-0.5 text-xs text-text-primary"
          onClick={() => {
            setStatus(null)
            setEditing(newGlossary())
            setCsv('')
          }}
        >
          {t('prefs.glossary.new')}
        </button>
      </div>

      {status && <p className="text-xs text-text-secondary">{status}</p>}

      {lists.length === 0 && !editing && (
        <p className="text-xs text-text-tertiary">{t('prefs.glossary.empty')}</p>
      )}

      {lists.length > 0 && (
        <ul className="space-y-1">
          {lists.map((list) => (
            <li key={list.id} className="flex items-center gap-2">
              <span className="text-xs text-text-primary">{list.name}</span>
              <span className="text-[11px] text-text-muted">{glossarySummary(list, t)}</span>
              <button
                type="button"
                className="umuo-pressable ml-auto rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary"
                onClick={() => startEditing(list)}
              >
                {t('prefs.glossary.edit')}
              </button>
              <button
                type="button"
                className="umuo-pressable rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary"
                onClick={() => void copyCsv(list)}
              >
                {t('prefs.glossary.copyCsv')}
              </button>
              <button
                type="button"
                className="umuo-pressable rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary"
                onClick={() => void remove(list)}
              >
                {t('prefs.glossary.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <GlossaryEditor
          t={t}
          glossary={editing}
          csv={csv}
          onChange={setEditing}
          onCsvChange={setCsv}
          onCancel={() => setEditing(null)}
          onSave={(text) => void save(editing, text)}
        />
      )}
    </div>
  )
}

function GlossaryEditor({
  t,
  glossary,
  csv,
  onChange,
  onCsvChange,
  onCancel,
  onSave,
}: {
  t: Translate
  glossary: Glossary
  csv: string
  onChange: (next: Glossary) => void
  onCsvChange: (next: string) => void
  onCancel: () => void
  onSave: (csv: string | null) => void
}) {
  return (
    <div className="space-y-2 rounded-card border border-border bg-background p-3">
      <label className="block text-xs text-text-secondary">
        {t('prefs.glossary.name')}
        <input
          className="mt-1 w-full rounded-control border border-border bg-background px-2 py-1 text-sm"
          value={glossary.name}
          placeholder={t('prefs.glossary.namePlaceholder')}
          spellCheck={false}
          onChange={(e) => onChange({ ...glossary, name: e.target.value })}
        />
      </label>

      <div className="flex gap-2">
        <label className="flex-1 text-xs text-text-secondary">
          {t('prefs.glossary.sourceLang')}
          <input
            className="mt-1 w-full rounded-control border border-border bg-background px-2 py-1 text-sm"
            value={glossary.sourceLang}
            placeholder={t('prefs.glossary.sourcePlaceholder')}
            spellCheck={false}
            onChange={(e) => onChange({ ...glossary, sourceLang: e.target.value })}
          />
        </label>
        <label className="flex-1 text-xs text-text-secondary">
          {t('prefs.glossary.targetLang')}
          <input
            className="mt-1 w-full rounded-control border border-border bg-background px-2 py-1 text-sm"
            value={glossary.targetLang}
            placeholder={t('prefs.glossary.targetPlaceholder')}
            spellCheck={false}
            onChange={(e) => onChange({ ...glossary, targetLang: e.target.value })}
          />
        </label>
      </div>

      <label className="block text-xs text-text-secondary">
        {t('prefs.glossary.entries')}
        <textarea
          className="mt-1 h-40 w-full rounded-control border border-border bg-background px-2 py-1 font-mono text-xs"
          value={csv}
          placeholder={t('prefs.glossary.entriesPlaceholder')}
          spellCheck={false}
          onChange={(e) => onCsvChange(e.target.value)}
        />
        <span className="mt-1 block text-[11px] text-text-muted">
          {t('prefs.glossary.entriesHint')}
        </span>
      </label>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className="umuo-pressable rounded-control border border-border bg-primary px-3 py-1 text-xs text-primary-foreground"
          onClick={() => onSave(csv)}
        >
          {t('prefs.glossary.saveImport')}
        </button>
        <button
          type="button"
          className="umuo-pressable rounded-control border border-border px-3 py-1 text-xs text-text-secondary"
          // 传 null 表示不动条目，只存名称与语言对。
          onClick={() => onSave(null)}
        >
          {t('prefs.glossary.saveMeta')}
        </button>
        <button
          type="button"
          className="umuo-pressable rounded-control border border-border px-3 py-1 text-xs text-text-secondary"
          onClick={onCancel}
        >
          {t('prefs.glossary.cancel')}
        </button>
      </div>
    </div>
  )
}
