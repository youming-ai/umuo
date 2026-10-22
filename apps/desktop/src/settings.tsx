import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { useT } from './lib/i18n'
import {
  api,
  onHotkeysRegistered,
  type Pick,
  type ProviderInfo,
  type ProviderUsage,
  type Settings,
  type StyleInfo,
  type Usage,
} from './lib/ipc'
import { spendFor } from './lib/limits'
import { createSettingsQueue, type SettingsQueue } from './lib/settings-queue'
import { initialTab, TABS, type TabId, tabAttention } from './lib/settings-tabs'
import { initUi } from './lib/ui-bootstrap'
import { AboutPage } from './settings/AboutPage'
import { AdvancedPage } from './settings/AdvancedPage'
import { EnginePage } from './settings/EnginePage'
import { GeneralPage } from './settings/GeneralPage'
import { SidebarIcon } from './settings/icons'
import { PermissionsPage } from './settings/PermissionsPage'
import { TranslatePage } from './settings/TranslatePage'
import './styles/app.css'

const TAB_TITLES = {
  general: 'prefs.tab.general',
  translate: 'prefs.tab.translate',
  engine: 'prefs.tab.engine',
  permissions: 'prefs.tab.permissions',
  advanced: 'prefs.tab.advanced',
  about: 'prefs.tab.about',
} as const

/**
 * 设置窗：左侧分区、右侧分组的行。**改了就存**，没有「保存」按钮——
 * 保存的顺序与失败回滚见 `lib/settings-queue.ts`；API Key 是唯一例外（要明确按「保存」）。
 */
function SettingsApp() {
  const t = useT()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [styles, setStyles] = useState<StyleInfo[]>([])
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null)
  const [accessibility, setAccessibility] = useState<boolean | null>(null)
  const [screenRecording, setScreenRecording] = useState<boolean | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [autostart, setAutostart] = useState<boolean | null>(null)
  const [hotkeyFailures, setHotkeyFailures] = useState<string[]>([])
  const [picks, setPicks] = useState<Pick[]>([])
  const [usage, setUsage] = useState<Usage | null>(null)
  const [spend, setSpend] = useState<ProviderUsage[]>([])
  const [tab, setTab] = useState<TabId | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const queue = useRef<SettingsQueue<Settings> | null>(null)

  const adopt = useCallback((loaded: Settings) => {
    // 每次保存都先读后端此刻的值再叠上改动：设置窗开着时浮窗也会写设置（按 App 记住的目标语言等），
    // 拿窗口里的旧快照整份写回会把它们抹掉。
    queue.current = createSettingsQueue(
      loaded,
      async (patch) => api.saveSettings({ ...(await api.getSettings()), ...patch }),
      setSettings,
    )
    setSettings(loaded)
  }, [])

  const recheckPermissions = useCallback(async () => {
    const [ax, screen] = await Promise.all([
      api.accessibilityTrusted().catch(() => null),
      api.ocrPermission().catch(() => null),
    ])
    setAccessibility(ax)
    setScreenRecording(screen)
    return { ax, screen }
  }, [])

  useEffect(() => {
    void (async () => {
      // 这一段失败时页面会永远停在「载入中」，所以把原因显示出来。
      const loaded = await Promise.all([
        api.providerCatalog(),
        api.styleCatalog(),
        api.getSettings(),
      ]).catch((error: unknown) => {
        setLoadError(String(error))
        return null
      })
      if (!loaded) return
      const [catalog, styleList, current] = loaded
      setProviders(catalog)
      setStyles(styleList)
      adopt(current)

      const [configured, permissions] = await Promise.all([
        api.keyStatus(current.providerId).catch(() => null),
        recheckPermissions(),
      ])
      // 本机模型（Ollama / LM Studio）不需要 Key，不能因为「没配 Key」而点灯、被送去引擎页。
      const needsKey = catalog.find((p) => p.id === current.providerId)?.requiresKey ?? true
      setKeyConfigured(needsKey ? configured : true)
      const permissionMissing = missingPermission(permissions.ax, permissions.screen)
      setTab(
        initialTab({
          keyConfigured: needsKey ? configured : true,
          permissionMissing,
          someProviderOverLimit: false,
        }),
      )

      // 下面这些都是参考信息：读不到不该拖垮设置窗。
      void api
        .appVersion()
        .then(setAppVersion)
        .catch(() => {})
      void api
        .autostartStatus()
        .then(setAutostart)
        .catch(() => setAutostart(null))
      void api
        .hotkeyFailures()
        .then(setHotkeyFailures)
        .catch(() => {})
      void api
        .comparePicks()
        .then(setPicks)
        .catch(() => {})
      void api
        .usageSummary()
        .then(setUsage)
        .catch(() => {})
      void api
        .monthlySpend()
        .then(setSpend)
        .catch(() => {})
    })()
  }, [adopt, recheckPermissions])

  // 快捷键重注册完成后重新读失败清单（Rust 侧发事件，比猜一个延时可靠）。
  useEffect(() => {
    const unlisten = onHotkeysRegistered(() => {
      void api
        .hotkeyFailures()
        .then(setHotkeyFailures)
        .catch(() => {})
    })
    return () => {
      void unlisten.then((stop) => stop())
    }
  }, [])

  // 用户多半是去系统设置授完权、或在浮窗里改了点什么再切回来——回到窗口时权限与设置都再读一次。
  useEffect(() => {
    const onFocus = () => {
      void recheckPermissions()
      void api
        .getSettings()
        .then((latest) => queue.current?.refresh(latest))
        .catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [recheckPermissions])

  // 供应商一变就重查 Key 状态，不管是从哪里改的：引擎页的下拉、翻译页的「常用组合」、
  // 还是别的窗口改了设置后聚焦刷新。之前只有引擎页自己查，常用组合换了供应商后
  // 侧栏的提示点还停在旧供应商上（审查 L27）。
  const activeProviderId = settings?.providerId
  useEffect(() => {
    if (activeProviderId === undefined) return
    // 本机模型不需要 Key：与首次载入时同一条规则。
    if (!(providers.find((p) => p.id === activeProviderId)?.requiresKey ?? true)) {
      setKeyConfigured(true)
      return
    }
    // 结果回来时供应商可能又换了：只认最后一次。
    let stale = false
    api
      .keyStatus(activeProviderId)
      .then((configured) => {
        if (!stale) setKeyConfigured(configured)
      })
      // 查不到时置为「不知道」，而不是留着上一个供应商的结论（审查 L28）。
      .catch(() => {
        if (!stale) setKeyConfigured(null)
      })
    return () => {
      stale = true
    }
  }, [activeProviderId, providers])

  if (!settings || !tab) {
    return (
      <main className="space-y-2 p-6 text-sm">
        {loadError ? (
          <>
            <p className="text-error">{t('settings.loadError', { reason: loadError })}</p>
            <p className="text-xs text-text-tertiary">{t('settings.loadErrorHint')}</p>
          </>
        ) : (
          <p className="text-text-tertiary">{t('settings.loading')}</p>
        )}
      </main>
    )
  }

  /**
   * 提交一次改动。失败时除了交给调用方（文本框会把原因写在自己那一行），也显示在页面顶部——
   * 下拉框、开关这类控件没有自己的错误位置，否则会「悄悄弹回去」。
   * 这里挂上的 catch 也让 `void commit(...)` 的调用不会变成未处理的 rejection。
   */
  const commit = (patch: Partial<Settings>) => {
    if (!queue.current) return Promise.resolve()
    setSaveError(null)
    const pending = queue.current.commit(patch)
    pending.catch((error: unknown) => setSaveError(String(error)))
    return pending
  }

  const attention = tabAttention({
    keyConfigured,
    permissionMissing: missingPermission(accessibility, screenRecording),
    someProviderOverLimit: settings.monthlyLimits.some(
      (limit) => spendFor(spend, limit.providerId) >= limit.limitUsd,
    ),
  })

  const page = { settings, commit, t }

  return (
    <div className="flex h-screen">
      <nav
        aria-label={t('prefs.sidebar')}
        className="pref-sidebar w-48 shrink-0 space-y-0.5 p-3 pt-10"
      >
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            className={[
              'flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left text-[13px]',
              tab === id ? 'pref-sidebar-active font-medium' : 'umuo-pressable',
            ].join(' ')}
            onClick={() => setTab(id)}
          >
            <SidebarIcon tab={id} />
            <span className="flex-1 text-text-primary">{t(TAB_TITLES[id])}</span>
            {attention[id] && (
              <span
                className="inline-block size-1.5 rounded-full bg-warning"
                title={t('prefs.attention')}
              />
            )}
          </button>
        ))}
      </nav>

      <main className="pref-pane min-w-0 flex-1 overflow-y-auto px-6 py-6">
        <h1 className="sr-only">{t(TAB_TITLES[tab])}</h1>
        <div className="mx-auto max-w-xl">
          {saveError && (
            <p
              role="alert"
              className="mb-4 rounded-card border border-error-border bg-error-surface px-4 py-2.5 text-xs text-error"
            >
              {t('prefs.saveFailed', { reason: saveError })}
            </p>
          )}
          {tab === 'general' && (
            <GeneralPage
              {...page}
              autostart={autostart}
              onAutostart={async (enabled) => {
                // 磁盘写得成不成功只有 Rust 侧知道，以它返回的状态为准。
                // 被拒绝时（例如从磁盘映像里运行）要把原因摆出来，不能只是开关弹回去。
                let actual: boolean
                try {
                  actual = await api.setAutostart(enabled)
                } catch (error) {
                  setSaveError(String(error))
                  return
                }
                setAutostart(actual)
                await commit({ launchAtLogin: actual })
              }}
              onImported={async () => {
                const [latest, styleList] = await Promise.all([
                  api.getSettings(),
                  api.styleCatalog(),
                ])
                // 导入可能带来新的自建风格：风格下拉框的目录也要一起刷新。
                setStyles(styleList)
                if (queue.current) queue.current.refresh(latest)
                else adopt(latest)
              }}
            />
          )}
          {tab === 'translate' && (
            <TranslatePage
              {...page}
              providers={providers}
              styles={styles}
              picks={picks}
              hotkeyFailures={hotkeyFailures}
              onStylesChanged={async () => setStyles(await api.styleCatalog())}
              onNavigate={setTab}
            />
          )}
          {tab === 'engine' && (
            <EnginePage
              {...page}
              providers={providers}
              keyConfigured={keyConfigured}
              onKeyConfigured={(configured, providerId) => {
                const needsKey = providers.find((p) => p.id === providerId)?.requiresKey ?? true
                setKeyConfigured(needsKey ? configured : true)
              }}
            />
          )}
          {tab === 'permissions' && (
            <PermissionsPage
              t={t}
              accessibility={accessibility}
              screenRecording={screenRecording}
              onRecheck={async () => {
                await recheckPermissions()
              }}
            />
          )}
          {tab === 'advanced' && (
            <AdvancedPage {...page} providers={providers} usage={usage} spend={spend} />
          )}
          {tab === 'about' && <AboutPage t={t} appVersion={appVersion} />}
        </div>
      </main>
    </div>
  )
}

/**
 * 是否缺权限：任一项**确定**没授权就算缺（哪怕另一项没读出来）；两项都确定已授权才算不缺；
 * 其余（有读不出来的、但没有确定缺的）算「不知道」，不点灯。
 */
function missingPermission(...states: Array<boolean | null>): boolean | null {
  if (states.some((state) => state === false)) return true
  if (states.every((state) => state === true)) return false
  return null
}

const container = document.getElementById('root')
if (!container) throw new Error('missing #root in settings.html')
// 主题在首屏渲染前定好，避免「先渲染成另一套、再被纠正」的闪一下。
void initUi()
createRoot(container).render(<SettingsApp />)
