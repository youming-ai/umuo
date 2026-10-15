import { useState } from 'react'

import { GlossaryManager } from '../components/GlossaryManager'
import { LanguageSelect } from '../components/LanguageSelect'
import { ModelRefList } from '../components/ModelRefList'
import { StylePresets } from '../components/StylePresets'
import { checkHotkey } from '../lib/hotkey-conflict'
import { parseDoubleTap } from '../lib/hotkey-format'
import type { Translate } from '../lib/i18n'
import type { Pick, ProviderInfo, Settings, StyleInfo } from '../lib/ipc'
import { languageLabel } from '../lib/languages'
import type { TabId } from '../lib/settings-tabs'
import { HotkeyRecorder } from './HotkeyRecorder'
import type { PageProps } from './types'
import { Button, DraftInput, Group, LinkRowButton, Row, Select } from './ui'

type HotkeyKey =
  | 'selectionHotkey'
  | 'silentReplaceHotkey'
  | 'composeHotkey'
  | 'ocrHotkey'
  | 'ocrSilentHotkey'
  | 'compareHotkey'
  | 'speakHotkey'

const HOTKEY_NAMES: Record<HotkeyKey, Parameters<Translate>[0]> = {
  selectionHotkey: 'prefs.translate.selection',
  silentReplaceHotkey: 'prefs.translate.silent',
  composeHotkey: 'prefs.translate.compose',
  ocrHotkey: 'prefs.translate.ocr',
  ocrSilentHotkey: 'prefs.translate.ocrSilent',
  compareHotkey: 'prefs.translate.compare',
  speakHotkey: 'prefs.translate.speak',
}

export function TranslatePage({
  settings,
  commit,
  t,
  providers,
  styles,
  picks,
  hotkeyFailures,
  onStylesChanged,
  onNavigate,
}: PageProps & {
  providers: ProviderInfo[]
  styles: StyleInfo[]
  picks: Pick[]
  /** 注册失败的快捷键（设置字段名）。 */
  hotkeyFailures: string[]
  onStylesChanged: () => Promise<void>
  onNavigate: (tab: TabId) => void
}) {
  const provider = providers.find((p) => p.id === settings.providerId)
  const hotkey = (key: HotkeyKey, description: string, title?: string) => (
    <HotkeyRow
      key={key}
      field={key}
      settings={settings}
      commit={commit}
      t={t}
      description={description}
      title={title}
      failed={hotkeyFailures.includes(key)}
    />
  )

  return (
    <div className="space-y-6">
      <p className="px-1 text-xs leading-relaxed text-text-tertiary">
        {t('prefs.translate.intro')}
      </p>

      <Group title={t('prefs.translate.selection')}>
        {hotkey('selectionHotkey', t('prefs.translate.selectionHint'))}
        <Row
          title={t('prefs.translate.engine')}
          description={
            provider
              ? `${provider.label} · ${settings.model || provider.defaultModel}`
              : t('prefs.translate.engineUnset')
          }
          control={
            <LinkRowButton
              label={t('prefs.translate.engineManage')}
              onClick={() => onNavigate('engine')}
            />
          }
        />
        <Row
          title={t('prefs.translate.style')}
          description={t('prefs.translate.styleHint')}
          controlId="pref-style"
          control={
            <Select
              id="pref-style"
              value={settings.styleId}
              options={styles.map((s) => [
                s.id,
                s.custom ? t('prefs.translate.customStyleLabel', { name: s.label }) : s.label,
              ])}
              onChange={(styleId) => void commit({ styleId })}
            />
          }
        />
      </Group>

      <Group title={t('prefs.translate.silent')}>
        {hotkey('silentReplaceHotkey', t('prefs.translate.silentHint'))}
      </Group>

      <Group title={t('prefs.translate.compose')}>
        {hotkey('composeHotkey', t('prefs.translate.composeHint'))}
      </Group>

      <Group title={t('prefs.translate.compare')}>
        {hotkey('compareHotkey', t('prefs.translate.compareHint'))}
        <Row
          title={t('prefs.translate.compareModels')}
          description={t('prefs.translate.compareModelsHint')}
        >
          <ModelRefList
            value={settings.sceneModels.compare}
            onChange={(compare) =>
              void commit({ sceneModels: { ...settings.sceneModels, compare } })
            }
            // 对比只会调用存了 Key 的供应商（compare.rs），本机模型选进来也不会跑——干脆不让选。
            providers={providers.filter((p) => p.requiresKey)}
            addLabel={t('prefs.translate.compareAdd')}
            t={t}
            emptyHint={t('prefs.translate.compareEmpty')}
          />
        </Row>
        <Row
          title={t('prefs.translate.compareProviders')}
          description={t('prefs.translate.compareProvidersHint')}
        >
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {providers
              .filter((p) => p.requiresKey)
              .map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={settings.compareProviders.includes(p.id)}
                    onChange={(event) =>
                      void commit({
                        compareProviders: event.target.checked
                          ? [...settings.compareProviders, p.id]
                          : settings.compareProviders.filter((id) => id !== p.id),
                      })
                    }
                  />
                  {p.label}
                </label>
              ))}
          </div>
        </Row>
        {picks.length > 0 && (
          <Row title={t('prefs.translate.picks')} description={t('prefs.translate.picksHint')}>
            <ul className="space-y-1">
              {picks.slice(0, 3).map((pick) => (
                <li key={`${pick.providerId}:${pick.model}`} className="flex items-center gap-2">
                  <span className="flex-1 text-xs text-text-secondary">
                    {t('prefs.translate.pickLine', {
                      count: pick.count,
                      provider: pick.providerId,
                      model: pick.model,
                    })}
                  </span>
                  <Button
                    onClick={() => void commit({ providerId: pick.providerId, model: pick.model })}
                  >
                    {t('prefs.translate.pickUse')}
                  </Button>
                </li>
              ))}
            </ul>
          </Row>
        )}
      </Group>

      <Group title={t('prefs.translate.ocr')}>
        {hotkey('ocrHotkey', t('prefs.translate.ocrHint'))}
        {hotkey(
          'ocrSilentHotkey',
          t('prefs.translate.ocrSilentHint'),
          t('prefs.translate.ocrSilent'),
        )}
        <Row
          title={t('prefs.translate.ocrEngine')}
          description={t('prefs.translate.ocrEngineHint')}
        />
      </Group>

      <Group title={t('prefs.translate.speak')}>
        {hotkey('speakHotkey', t('prefs.translate.speakHint'))}
      </Group>

      <LanguageRules settings={settings} commit={commit} t={t} />

      <Group>
        <Row
          title={t('prefs.translate.customStyles')}
          description={t('prefs.translate.customStylesHint')}
        >
          <StylePresets
            styles={settings.customStyles}
            selectedId={settings.styleId}
            t={t}
            onSave={async (customStyles) => {
              await commit({ customStyles })
              // 目录里也要带上新预设，否则风格下拉框要等重开窗口才更新。
              await onStylesChanged()
            }}
          />
        </Row>
      </Group>

      <Group>
        <Row title={t('prefs.translate.glossary')} description={t('prefs.translate.glossaryHint')}>
          <GlossaryManager t={t} />
        </Row>
      </Group>
    </div>
  )
}

function LanguageRules({ settings, commit, t }: PageProps) {
  const [blacklistError, setBlacklistError] = useState<string | null>(null)
  const remembered = Object.entries(settings.appTargetLangs ?? {})

  return (
    <Group title={t('prefs.translate.rules')}>
      <Row
        title={t('prefs.translate.targetMode')}
        description={t('prefs.translate.targetModeHint')}
        controlId="pref-target-mode"
        control={
          <Select
            id="pref-target-mode"
            value={settings.targetLangMode}
            options={[
              ['fixed', t('prefs.translate.targetFixed')],
              ['perApp', t('prefs.translate.targetPerApp')],
            ]}
            onChange={(targetLangMode) => void commit({ targetLangMode })}
          />
        }
      >
        {settings.targetLangMode === 'perApp' &&
          (remembered.length === 0 ? (
            <p className="text-xs text-text-tertiary">{t('prefs.translate.rememberedEmpty')}</p>
          ) : (
            <ul className="space-y-1">
              {remembered.map(([app, code]) => (
                <li key={app} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-text-secondary">
                    {app} → {languageLabel(code)}
                  </span>
                  <Button
                    onClick={() => {
                      const next = { ...settings.appTargetLangs }
                      delete next[app]
                      void commit({ appTargetLangs: next })
                    }}
                  >
                    {t('prefs.translate.forget')}
                  </Button>
                </li>
              ))}
            </ul>
          ))}
      </Row>
      <Row
        title={t('prefs.translate.secondaryLang')}
        description={t('prefs.translate.secondaryLangHint')}
        controlId="pref-secondary-lang"
        control={
          <LanguageSelect
            id="pref-secondary-lang"
            className="pref-select"
            value={settings.secondaryTargetLang}
            onChange={(secondaryTargetLang) => void commit({ secondaryTargetLang })}
          />
        }
      />
      <Row
        title={t('prefs.translate.blacklist')}
        description={t('prefs.translate.blacklistHint')}
        error={blacklistError}
      >
        <DraftInput
          multiline
          label={t('prefs.translate.blacklist')}
          value={settings.selectionBlacklist.join('\n')}
          onError={setBlacklistError}
          onCommit={(text) =>
            commit({
              selectionBlacklist: text
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line !== ''),
            })
          }
        />
      </Row>
    </Group>
  )
}

function HotkeyRow({
  field,
  settings,
  commit,
  t,
  description,
  title,
  failed,
}: PageProps & {
  field: HotkeyKey
  description: string
  title?: string
  failed: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const others = (Object.keys(HOTKEY_NAMES) as HotkeyKey[])
    .filter((key) => key !== field)
    .map((key) => ({ label: t(HOTKEY_NAMES[key]), value: settings[key] }))
  const conflict = checkHotkey(settings[field], others)
  const warning = conflict
    ? conflict.kind === 'no-modifier'
      ? t('prefs.hotkey.noModifier')
      : conflict.kind === 'duplicate'
        ? t('prefs.hotkey.duplicate', { name: conflict.subject ?? '' })
        : t('prefs.hotkey.system', { name: conflict.subject ?? '' })
    : null
  const controlId = `pref-${field}`

  return (
    <Row
      title={title ?? t('prefs.translate.hotkey')}
      description={description}
      controlId={controlId}
      error={
        error ??
        (failed
          ? t(
              parseDoubleTap(settings[field])
                ? 'prefs.hotkey.tapFailed'
                : 'prefs.hotkey.registerFailed',
            )
          : warning)
      }
      control={
        <HotkeyRecorder
          id={controlId}
          t={t}
          value={settings[field]}
          onCommit={async (value) => {
            setError(null)
            // 与别的功能撞键就不存：两个功能抢同一个键，其中一个注册时会静默失败。
            const clash = checkHotkey(value, others)
            if (clash?.kind === 'duplicate') {
              setError(t('prefs.hotkey.duplicate', { name: clash.subject ?? '' }))
              return
            }
            try {
              await commit({ [field]: value } as Partial<Settings>)
            } catch (failure) {
              setError(String(failure))
              throw failure
            }
          }}
        />
      }
    />
  )
}
