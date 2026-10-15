import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageSelect } from './components/LanguageSelect'
import { hotkeyParts } from './lib/hotkey-format'
import { useT } from './lib/i18n'
import { api, type ProviderInfo, type Settings } from './lib/ipc'
import {
  hasUsableEngine,
  isStepSatisfied,
  nextStep,
  type OnboardingState,
  prevStep,
  progressOf,
  STEPS,
  type StepId,
} from './lib/onboarding'
import { initUi } from './lib/ui-bootstrap'
import './styles/app.css'

/** 引导里用的示例句：一句常见的英文，够短、看一眼就知道翻得对不对。 */
const SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog.'

/**
 * 首次启动引导（PRD §7.4，五步）。
 *
 * 两条刻意的产品规则：
 *
 * 1. **不阻止前进。** 权限可以稍后授予、模型可以稍后再配——把人卡在某一步，
 *    他只会卸载，而不是去系统设置里点一下。
 * 2. **但要说清后果。** 一个引擎都没有时引导仍然可以结束，但页面上会写明
 *    「这样客户端翻不了任何东西」，而不是让他事后以为软件坏了。
 */
function Onboarding() {
  const t = useT()
  const [step, setStep] = useState<StepId>('welcome')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [localModel, setLocalModel] = useState<string | null>(null)
  const [trusted, setTrusted] = useState<boolean | null>(null)
  const [screenGranted, setScreenGranted] = useState<boolean | null>(null)
  const [practiced, setPracticed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [catalog, current, trustedNow] = await Promise.all([
          api.providerCatalog(),
          api.getSettings(),
          api.accessibilityTrusted(),
        ])
        // `t` 只在上面那行错误提示里用，但 biome 要求依赖一致——照做。
        setProviders(catalog)
        setSettings(current)
        setTrusted(trustedNow)
        setKeyConfigured(await api.keyStatus(current.providerId))
        setScreenGranted(await api.ocrPermission().catch(() => null))
      } catch (error) {
        setNotice(t('onboarding.settingsFailed', { reason: String(error) }))
      }
    })()
    // `t` 随界面语言变化，错误文案要跟着换。
  }, [t])

  if (!settings) {
    return (
      <main className="p-8 text-sm text-text-tertiary">
        {notice ?? t('onboarding.readingSettings')}
      </main>
    )
  }

  const state: OnboardingState = {
    targetLang: settings.targetLang,
    keyConfigured,
    localModelFound: localModel !== null,
    accessibilityTrusted: trusted === true,
    screenRecordingGranted: screenGranted === true,
    practiced,
  }
  const progress = progressOf(state)
  const index = STEPS.findIndex((item) => item.id === step)

  const finish = async () => {
    try {
      await api.finishOnboarding()
    } catch (error) {
      setNotice(String(error))
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background text-text-primary">
      <header className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">{t('onboarding.title')}</h1>
          <span className="text-xs text-text-muted">
            {t('onboarding.progress', {
              step: index + 1,
              total: STEPS.length,
              done: progress.done,
            })}
          </span>
        </div>
        <ol className="mt-3 flex gap-2">
          {STEPS.map((item, i) => (
            <li
              key={item.id}
              className={[
                'flex-1 rounded-control border px-2 py-1 text-center text-[11px]',
                i === index ? 'border-primary text-text-primary' : 'border-border text-text-muted',
                isStepSatisfied(item.id, state) && i !== index ? 'text-text-secondary' : '',
              ].join(' ')}
            >
              {item.title}
              {isStepSatisfied(item.id, state) ? ' ✓' : ''}
            </li>
          ))}
        </ol>
      </header>

      <main className="flex-1 overflow-auto px-6 py-5">
        {step === 'welcome' && <Welcome settings={settings} />}
        {step === 'languages' && <Languages settings={settings} onChange={setSettings} />}
        {step === 'model' && (
          <ModelStep
            providers={providers}
            settings={settings}
            keyConfigured={keyConfigured}
            localModel={localModel}
            onKeySaved={() => setKeyConfigured(true)}
            onLocalModel={setLocalModel}
            onNotice={setNotice}
          />
        )}
        {step === 'permissions' && (
          <Permissions
            settings={settings}
            trusted={trusted}
            screenGranted={screenGranted}
            onRefreshTrusted={setTrusted}
            onRefreshScreen={setScreenGranted}
          />
        )}
        {step === 'practice' && (
          <Practice
            practiced={practiced}
            onPracticed={() => setPracticed(true)}
            onNotice={setNotice}
          />
        )}
      </main>

      <footer className="space-y-2 border-t border-border px-6 py-4">
        {!hasUsableEngine(state) && step === 'practice' && (
          <p className="text-xs text-warning">{t('onboarding.noEngineWarning')}</p>
        )}
        {notice && <p className="text-xs text-text-secondary">{notice}</p>}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="umuo-pressable rounded-control border border-border px-3 py-1 text-xs text-text-secondary"
            disabled={prevStep(step) === null}
            onClick={() => {
              const previous = prevStep(step)
              if (previous) setStep(previous)
            }}
          >
            {t('onboarding.prev')}
          </button>
          <button
            type="button"
            className="umuo-pressable ml-auto rounded-control border border-border px-3 py-1 text-xs text-text-secondary"
            onClick={() => void finish()}
          >
            {t('onboarding.skip')}
          </button>
          {nextStep(step) ? (
            <button
              type="button"
              className="umuo-pressable rounded-control border border-border bg-primary px-4 py-1 text-xs text-primary-foreground"
              onClick={() => {
                const next = nextStep(step)
                if (next) setStep(next)
              }}
            >
              {t('onboarding.next')}
            </button>
          ) : (
            <button
              type="button"
              className="umuo-pressable rounded-control border border-border bg-primary px-4 py-1 text-xs text-primary-foreground"
              onClick={() => void finish()}
            >
              {t('onboarding.finish')}
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}

/** 键帽文字（`Alt+Cmd+O` → `⌥⌘O`）；同一格放两个功能时用「 / 」隔开。 */
function keysLabel(...values: string[]): string {
  return values.map((value) => hotkeyParts(value).join('')).join(' / ')
}

/** 引导里提到的键位一律读当前设置：默认键位换过一次，老用户的设置里仍是旧键位。 */
function Welcome({ settings }: { settings: Settings }) {
  const t = useT()
  const items: Array<[string, string, string]> = [
    [t('onboarding.read'), keysLabel(settings.selectionHotkey), t('onboarding.readDesc')],
    [
      t('onboarding.write'),
      keysLabel(settings.composeHotkey, settings.silentReplaceHotkey),
      t('onboarding.writeDesc'),
    ],
    [
      t('onboarding.see'),
      keysLabel(settings.ocrHotkey, settings.ocrSilentHotkey),
      t('onboarding.seeDesc'),
    ],
  ]
  return (
    <div className="space-y-4">
      <p className="lead">{t('onboarding.intro')}</p>
      <ul className="space-y-2">
        {items.map(([kind, keys, description]) => (
          <li key={kind} className="flex items-baseline gap-3">
            <span className="w-6 text-xs text-text-tertiary">{kind}</span>
            <kbd className="rounded-control border border-border bg-background-tertiary px-2 py-0.5 font-heading text-xs">
              {keys}
            </kbd>
            <span className="text-sm text-text-secondary">{description}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-text-muted">{t('onboarding.walkthrough')}</p>
    </div>
  )
}

function Languages({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (next: Settings) => void
}) {
  const t = useT()
  return (
    <div className="space-y-4">
      <p className="lead">{t('onboarding.languagesLead')}</p>
      <label className="block text-xs text-text-secondary" htmlFor="umuo-onboarding-target">
        {t('onboarding.primaryTarget')}{' '}
        <div className="mt-1">
          <LanguageSelect
            id="umuo-onboarding-target"
            value={settings.targetLang}
            onChange={(targetLang) => onChange({ ...settings, targetLang })}
          />
        </div>
      </label>
      <label className="block text-xs text-text-secondary" htmlFor="umuo-onboarding-secondary">
        {t('onboarding.secondaryTarget')}{' '}
        <div className="mt-1">
          <LanguageSelect
            id="umuo-onboarding-secondary"
            value={settings.secondaryTargetLang}
            onChange={(secondaryTargetLang) => onChange({ ...settings, secondaryTargetLang })}
          />
        </div>
      </label>
      <p className="text-xs text-text-muted">{t('onboarding.languagesNote')}</p>
    </div>
  )
}

function ModelStep({
  providers,
  settings,
  keyConfigured,
  localModel,
  onKeySaved,
  onLocalModel,
  onNotice,
}: {
  providers: ProviderInfo[]
  settings: Settings
  keyConfigured: boolean
  localModel: string | null
  onKeySaved: () => void
  onLocalModel: (model: string | null) => void
  onNotice: (message: string | null) => void
}) {
  const [providerId, setProviderId] = useState(settings.providerId)
  const [apiKey, setApiKey] = useState('')
  const t = useT()

  const provider = providers.find((item) => item.id === providerId)

  return (
    <div className="space-y-4">
      <p className="lead">
        <p className="lead">{t('onboarding.modelLead')}</p>{' '}
      </p>

      <div className="flex items-end gap-2">
        <label className="text-xs text-text-secondary">
          {t('onboarding.provider')}
          <select
            className="mt-1 block rounded-control border border-border bg-background px-2 py-1.5 text-sm"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          >
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 flex-1 text-xs text-text-secondary">
          API Key
          <input
            className="mt-1 w-full rounded-control border border-border bg-background px-2 py-1.5 text-sm"
            type="password"
            value={apiKey}
            placeholder={
              keyConfigured
                ? t('onboarding.keyPlaceholderConfigured')
                : t('onboarding.keyPlaceholderEmpty')
            }
            spellCheck={false}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="umuo-pressable rounded-control border border-border bg-primary px-3 py-1.5 text-xs text-primary-foreground"
          disabled={apiKey.trim() === ''}
          onClick={() =>
            void api
              .saveApiKey(providerId, apiKey.trim())
              .then(() => {
                setApiKey('')
                onKeySaved()
                onNotice(t('onboarding.keySaved', { provider: provider?.label ?? providerId }))
              })
              .catch((error: unknown) => onNotice(String(error)))
          }
        >
          {t('onboarding.save')}
        </button>
      </div>

      {provider?.keysUrl && (
        <button
          type="button"
          className="umuo-pressable text-xs text-brand-accent underline"
          onClick={() => void api.openExternal(provider.keysUrl)}
        >
          {t('onboarding.getKey', { provider: provider.label })}
        </button>
      )}

      <div className="space-y-2 border-t border-border-secondary pt-4">
        <p className="text-xs text-text-secondary">
          <p className="text-xs text-text-muted">{t('onboarding.noKeyLead')}</p>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="umuo-pressable rounded-control border border-border px-3 py-1 text-xs text-text-primary"
            onClick={() =>
              void api
                .listModels('ollama')
                .then((models) => {
                  if (models.length === 0) {
                    onLocalModel(null)
                    onNotice(t('onboarding.ollamaNoModels'))
                    return
                  }
                  onLocalModel(models[0])
                  onNotice(t('onboarding.detectedModel', { model: models[0] }))
                })
                .catch(() => {
                  onLocalModel(null)
                  onNotice(t('onboarding.ollamaMissing'))
                })
            }
          >
            {t('onboarding.detectOllama')}
          </button>
          {localModel && (
            <span className="text-xs text-success">
              {t('onboarding.detectedModel', { model: localModel })}
            </span>
          )}
        </div>
        <p className="text-xs text-text-muted">{t('onboarding.stepSkippable')}</p>
      </div>
    </div>
  )
}

function Permissions({
  settings,
  trusted,
  screenGranted,
  onRefreshTrusted,
  onRefreshScreen,
}: {
  settings: Settings
  trusted: boolean | null
  screenGranted: boolean | null
  onRefreshTrusted: (value: boolean) => void
  onRefreshScreen: (value: boolean) => void
}) {
  const t = useT()
  return (
    <div className="space-y-4">
      <p className="lead">{t('onboarding.permissionsLead')}</p>

      <section className="space-y-2 rounded-card border border-border bg-background-surface p-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t('onboarding.accessibility')}</h2>
          <span className={`text-xs ${trusted ? 'text-success' : 'text-warning'}`}>
            {trusted === null
              ? t('onboarding.reading')
              : trusted
                ? t('onboarding.granted')
                : t('onboarding.notGranted')}
          </span>
        </div>
        <p className="text-xs text-text-secondary">{t('onboarding.accessibilityDesc')}</p>
        <div className="flex gap-2">
          <button
            type="button"
            className="umuo-pressable rounded-control border border-border px-3 py-1 text-xs text-text-primary"
            onClick={() => void api.openAccessibilitySettings()}
          >
            {t('onboarding.openSystemSettings')}
          </button>
          <button
            type="button"
            className="umuo-pressable rounded-control border border-border px-3 py-1 text-xs text-text-secondary"
            onClick={() => void api.accessibilityTrusted().then(onRefreshTrusted)}
          >
            {t('onboarding.recheck')}
          </button>
        </div>
      </section>

      <section className="space-y-2 rounded-card border border-border bg-background-surface p-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t('onboarding.screenRecording')}</h2>
          <span className={`text-xs ${screenGranted ? 'text-success' : 'text-text-muted'}`}>
            {screenGranted === null
              ? t('onboarding.reading')
              : screenGranted
                ? t('onboarding.granted')
                : t('onboarding.notGranted')}
          </span>
        </div>
        <p className="text-xs text-text-secondary">
          {t('onboarding.screenRecordingDesc', {
            keys: keysLabel(settings.ocrHotkey, settings.ocrSilentHotkey),
          })}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="umuo-pressable rounded-control border border-border px-3 py-1 text-xs text-text-primary"
            onClick={() => void api.ocrRequestPermission().then(onRefreshScreen)}
          >
            {t('onboarding.requestPermission')}
          </button>
          <button
            type="button"
            className="umuo-pressable rounded-control border border-border px-3 py-1 text-xs text-text-secondary"
            onClick={() => void api.openScreenRecordingSettings()}
          >
            {t('onboarding.openSystemSettings')}
          </button>
        </div>
        <p className="text-xs text-text-muted">
          <p className="text-xs text-text-muted">{t('onboarding.systemDialogOnce')}</p>
        </p>
      </section>
    </div>
  )
}

function Practice({
  practiced,
  onPracticed,
  onNotice,
}: {
  practiced: boolean
  onPracticed: () => void
  onNotice: (message: string | null) => void
}) {
  const t = useT()
  return (
    <div className="space-y-4">
      <p className="lead">
        <p className="lead">{t('onboarding.practiceLead')}</p>
      </p>
      <div className="rounded-card border border-border bg-background-tertiary p-4">
        <p className="font-mono text-sm text-text-primary">{SAMPLE_TEXT}</p>
      </div>
      <button
        type="button"
        className="umuo-pressable rounded-control border border-border bg-primary px-4 py-1.5 text-xs text-primary-foreground"
        onClick={() =>
          void api
            .translateText(SAMPLE_TEXT)
            .then(() => {
              onPracticed()
              onNotice(t('onboarding.practiceSeen'))
            })
            .catch((error: unknown) => onNotice(String(error)))
        }
      >
        {t('onboarding.practiceButton')}
      </button>
      {practiced && (
        <p className="text-xs text-success">
          <p className="text-xs text-success">{t('onboarding.practiceSeen')}</p>
        </p>
      )}
      <p className="text-xs text-text-muted">
        <p className="text-xs text-text-muted">{t('onboarding.practiceHint')}</p>
      </p>
    </div>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('missing #root mount point: onboarding.html is broken')
// 主题在首屏渲染前定好，避免「先渲染成另一套、再被纠正」的闪一下。
void initUi()
createRoot(container).render(<Onboarding />)
