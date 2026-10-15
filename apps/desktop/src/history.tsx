import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import {
  dailyBars,
  dayBarTitle,
  favoriteMeta,
  formatTimestamp,
  recordMeta,
  usageLine,
} from './lib/history-format'
import { useT } from './lib/i18n'
import {
  api,
  type DayUsage,
  type Facets,
  type Favorite,
  type HistoryRecord,
  type Usage,
} from './lib/ipc'
import { initUi } from './lib/ui-bootstrap'
import './styles/app.css'

/** 搜索输入的防抖：每敲一个字就查一次库没必要，输入停顿后再查。 */
const SEARCH_DEBOUNCE_MS = 250
const PAGE_SIZE = 100
/** 按日柱状图看多少天。 */
const BAR_WINDOW_DAYS = 14

type Tab = 'history' | 'favorites'

/**
 * 翻译历史窗（PRD §5.9）。
 *
 * 两个分页：**历史**（列表 + 检索 + 删除 + 收藏）与**收藏**（用户显式保存的词句）。
 * 顶部是最近两周的按日用量（PRD §5.10 的「按日展示」）。
 *
 * 收藏与历史刻意不是同一份数据：历史会被「保留天数」清掉，收藏不会——
 * 用户不会希望三个月前收藏的那个词被自动删掉。
 */
function History() {
  const t = useT()
  const [tab, setTab] = useState<Tab>('history')
  const [records, setRecords] = useState<HistoryRecord[]>([])
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [favorited, setFavorited] = useState<boolean[]>([])
  const [usage, setUsage] = useState<Usage | null>(null)
  const [days, setDays] = useState<DayUsage[]>([])
  const [query, setQuery] = useState('')
  // 筛选（PRD §5.9）：与搜索是 AND 关系，三个条件一起送后端。
  const [appFilter, setAppFilter] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [facets, setFacets] = useState<Facets>({ apps: [], models: [] })
  const [privacyMode, setPrivacyMode] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const reload = useCallback(
    async (search: string, app: string, model: string) => {
      try {
        const rows = await api.historyQuery({ query: search, sourceApp: app, model }, PAGE_SIZE, 0)

        setRecords(rows)
        // 一次问完一屏的收藏状态，而不是逐行发一次 IPC。
        setFavorited(await api.favoritesStatus(rows.map((row) => row.sourceText)))
        setUsage(await api.usageSummary())
        setDays(await api.usageDaily(BAR_WINDOW_DAYS))
        setFavorites(await api.favoritesList(PAGE_SIZE, 0))
        setFacets(await api.historyFacets())
        // 隐私模式开着时列表是空的——说清楚原因，否则用户以为记录丢了。
        setPrivacyMode((await api.getSettings()).privacyMode)
        setStatus(null)
      } catch (error) {
        // 数据库打不开时要说清楚，而不是显示一个空列表让用户以为记录没了。
        setStatus(t('history.unavailable', { reason: String(error) }))
      }
    },
    [t],
  )

  useEffect(() => {
    const timer = window.setTimeout(
      () => void reload(query, appFilter, modelFilter),
      SEARCH_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [query, appFilter, modelFilter, reload])

  const toggleFavorite = async (record: HistoryRecord) => {
    // 收藏的是**原文 + 译文这一对**：语言学习者想留住的是那句外文，
    // 以及它对应的意思。判定「单词还是句子」由 Rust 侧用词卡规则决定，
    // 前端不重复实现那条规则。
    try {
      const nowFavorited = await api.favoriteToggle(record.sourceText, record.translatedText)
      setStatus(nowFavorited ? t('history.favorited') : t('history.unfavorited'))
      await reload(query, appFilter, modelFilter)
    } catch (error) {
      setStatus(String(error))
    }
  }

  const remove = async (id: number) => {
    await api.historyDelete(id)
    await reload(query, appFilter, modelFilter)
  }

  const clearAll = async () => {
    // 清空是破坏性操作，先确认。用原生 confirm 而不是自绘弹窗：
    // 这个窗口不是常驻 UI，原生对话框足够且不会被误点。
    if (!window.confirm(t('history.confirmClear'))) return
    const removed = await api.historyClear()
    setStatus(t('history.cleared', { count: removed }))
    await reload(query, appFilter, modelFilter)
  }

  const bars = dailyBars(days, BAR_WINDOW_DAYS)

  return (
    <div className="flex h-screen flex-col bg-background text-text-primary">
      <header className="space-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">{t('history.title')}</h1>
          <span className="text-xs text-text-muted">{usageLine(usage, t)}</span>
        </div>

        {bars.length > 0 && (
          <div className="flex items-end gap-1" title={t('history.chartTitle')}>
            {bars.map((bar) => (
              <div
                key={bar.day}
                className="flex flex-col items-center gap-1"
                title={dayBarTitle(bar, t)}
              >
                <div
                  className="w-3 rounded-sm bg-primary"
                  // 最小 2px：次数极少那天也留一条基线，
                  // 否则柱子整根消失、看起来像坏了。
                  style={{ height: `${Math.max(2, Math.round(bar.ratio * 36))}px` }}
                />
                <span className="text-[9px] text-text-muted">{bar.label}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <TabButton
            label={t('history.tabHistory')}
            active={tab === 'history'}
            onClick={() => setTab('history')}
          />
          <TabButton
            label={
              favorites.length > 0
                ? t('history.tabFavoritesCount', { count: favorites.length })
                : t('history.tabFavorites')
            }
            active={tab === 'favorites'}
            onClick={() => setTab('favorites')}
          />
          {tab === 'history' && (
            <button
              type="button"
              className="ml-auto rounded-control border border-border px-2 py-0.5 text-xs text-text-secondary"
              onClick={() => void clearAll()}
            >
              {t('history.clear')}
            </button>
          )}
        </div>

        {tab === 'history' && (
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-control border border-border bg-background px-2 py-1.5 text-sm"
              placeholder={t('history.searchPlaceholder')}
              value={query}
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
            {/* 候选值来自历史里真正出现过的值——给他一堆选了没结果的选项更烦。 */}
            <select
              className="rounded-control border border-border bg-background px-2 py-1.5 text-xs"
              value={appFilter}
              onChange={(event) => setAppFilter(event.target.value)}
            >
              <option value="">{t('history.allSources')}</option>
              {facets.apps.map((app) => (
                <option key={app} value={app}>
                  {app}
                </option>
              ))}
            </select>
            <select
              className="rounded-control border border-border bg-background px-2 py-1.5 text-xs"
              value={modelFilter}
              onChange={(event) => setModelFilter(event.target.value)}
            >
              <option value="">{t('history.allModels')}</option>
              {facets.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
        )}

        {tab === 'history' && privacyMode && (
          <p className="text-xs text-warning">{t('history.privacyNotice')}</p>
        )}
        {status && <p className="text-xs text-text-muted">{status}</p>}
      </header>

      <main className="flex-1 overflow-auto">
        {tab === 'history' ? (
          records.length === 0 ? (
            <Empty text={query.trim() ? t('history.emptyNoMatch') : t('history.emptyNoRecords')} />
          ) : (
            <ul>
              {records.map((record, index) => (
                <li
                  key={record.id}
                  className="border-b border-border-muted px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-text-muted">{formatTimestamp(record.createdAt)}</p>
                      <p className="mt-1 text-sm whitespace-pre-wrap text-text-primary">
                        {record.translatedText}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs whitespace-pre-wrap text-text-tertiary">
                        {record.sourceText}
                      </p>
                      <p className="mt-1 text-[11px] text-text-muted">{recordMeta(record, t)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        className={[
                          'rounded-control border px-2 py-0.5 text-[11px]',
                          favorited[index]
                            ? 'border-success-border text-success'
                            : 'border-border text-text-secondary',
                        ].join(' ')}
                        onClick={() => void toggleFavorite(record)}
                      >
                        {favorited[index] ? t('history.starOn') : t('history.starOff')}
                      </button>
                      <button
                        type="button"
                        className="umuo-pressable rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary"
                        onClick={() => void api.copyText(record.translatedText)}
                      >
                        {t('history.copy')}
                      </button>
                      <button
                        type="button"
                        className="umuo-pressable rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary"
                        title={t('history.editAgainHint')}
                        onClick={() =>
                          void api
                            .openComposeWith(record.sourceText, record.translatedText)
                            .catch((error: unknown) => setStatus(String(error)))
                        }
                      >
                        {t('history.editAgain')}
                      </button>
                      <button
                        type="button"
                        className="umuo-pressable rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary"
                        onClick={() => void remove(record.id)}
                      >
                        {t('history.delete')}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : favorites.length === 0 ? (
          <Empty text={t('history.emptyNoFavorites')} />
        ) : (
          <ul>
            {favorites.map((favorite) => (
              <li
                key={favorite.id}
                className="border-b border-border-muted px-4 py-3 last:border-b-0"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text-primary">{favorite.text}</p>
                    {favorite.translation && (
                      <p className="mt-1 text-sm whitespace-pre-wrap text-text-secondary">
                        {favorite.translation}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-text-muted">{favoriteMeta(favorite, t)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      className="umuo-pressable rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary"
                      onClick={() =>
                        void api
                          .copyText(favorite.translation ?? favorite.text)
                          .catch((error: unknown) => setStatus(String(error)))
                      }
                    >
                      {t('history.copy')}
                    </button>
                    <button
                      type="button"
                      className="umuo-pressable rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary"
                      onClick={() =>
                        void api
                          .favoriteRemove(favorite.id)
                          .then(() => reload(query, appFilter, modelFilter))
                          .catch((error: unknown) => setStatus(String(error)))
                      }
                    >
                      {t('history.remove')}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-6 text-sm text-text-tertiary">{text}</p>
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'rounded-control px-3 py-1 text-xs',
        active ? 'bg-background-tertiary text-text-primary' : 'text-text-secondary',
      ].join(' ')}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('missing #root mount point: history.html is broken')
// 主题在首屏渲染前定好，避免「先渲染成另一套、再被纠正」的闪一下。
void initUi()
createRoot(container).render(<History />)
