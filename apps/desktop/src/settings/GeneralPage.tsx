import { useState } from 'react'

import { LanguageSelect } from '../components/LanguageSelect'
import { LOCALES, type Translate } from '../lib/i18n'
import { api, type ImportSummary } from '../lib/ipc'
import { LANGUAGES } from '../lib/languages'
import { THEME_CHOICES } from '../lib/theme'
import type { PageProps } from './types'
import { Button, Group, LinkRowButton, Row, Select, Toggle } from './ui'

const THEME_KEYS = {
  system: 'prefs.theme.system',
  light: 'prefs.theme.light',
  dark: 'prefs.theme.dark',
  highContrast: 'prefs.theme.highContrast',
} as const

export function GeneralPage({
  settings,
  commit,
  t,
  autostart,
  onAutostart,
  onImported,
}: PageProps & {
  /** 开机启动以磁盘上的 LaunchAgent 为准；`null` = 还没读出来。 */
  autostart: boolean | null
  onAutostart: (enabled: boolean) => Promise<void>
  /** 导入配置后要整页重读设置。 */
  onImported: () => Promise<void>
}) {
  const [configPath, setConfigPath] = useState('')
  const [configNotice, setConfigNotice] = useState<string | null>(null)
  const [autostartError, setAutostartError] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <Group>
        <Row
          title={t('prefs.general.theme')}
          description={t('prefs.general.themeHint')}
          controlId="pref-theme"
          control={
            <Select
              id="pref-theme"
              value={settings.theme}
              options={THEME_CHOICES.map(([id]) => [id, t(THEME_KEYS[id])])}
              onChange={(theme) => void commit({ theme })}
            />
          }
        />
      </Group>

      <Group>
        <Row
          title={t('prefs.general.targetLang')}
          description={t('prefs.general.targetLangHint')}
          controlId="pref-target-lang"
          control={
            <LanguageSelect
              id="pref-target-lang"
              className="pref-select"
              value={settings.targetLang}
              onChange={(targetLang) => void commit({ targetLang })}
            />
          }
        />
        <Row
          title={t('prefs.general.nativeLang')}
          description={t('prefs.general.nativeLangHint')}
          controlId="pref-native-lang"
          control={
            <Select
              id="pref-native-lang"
              value={settings.nativeLang}
              options={[['', t('prefs.general.nativeLangUnset')], ...LANGUAGES]}
              onChange={(nativeLang) => void commit({ nativeLang })}
            />
          }
        />
        <Row
          title={t('prefs.general.uiLang')}
          description={t('prefs.general.uiLangHint')}
          controlId="pref-locale"
          control={
            <Select
              id="pref-locale"
              value={settings.locale}
              // 语言名用该语言自己写（通行做法）；只有「跟随系统」跟着界面语言走。
              options={LOCALES.map(([id, label]) => [
                id,
                id === 'system' ? t('prefs.followSystem') : label,
              ])}
              onChange={(locale) => void commit({ locale })}
            />
          }
        />
        <Row
          title={t('prefs.general.scale')}
          description={t('prefs.general.scaleHint')}
          controlId="pref-scale"
          control={
            <Select
              id="pref-scale"
              value={settings.uiScale}
              options={[0.85, 1, 1.25, 1.5].map((scale) => [scale, `${Math.round(scale * 100)}%`])}
              onChange={(uiScale) => void commit({ uiScale })}
            />
          }
        />
      </Group>

      <Group>
        <Row
          title={t('prefs.general.autostart')}
          description={t('prefs.general.autostartHint')}
          error={autostartError}
          control={
            <Toggle
              label={t('prefs.general.autostart')}
              checked={autostart ?? settings.launchAtLogin}
              onChange={(enabled) => {
                setAutostartError(null)
                onAutostart(enabled).catch((error: unknown) => setAutostartError(String(error)))
              }}
            />
          }
        />
        <Row
          title={t('prefs.general.onboarding')}
          description={t('prefs.general.onboardingHint')}
          control={
            <LinkRowButton
              label={t('prefs.general.onboarding')}
              onClick={() => void api.openOnboarding()}
            />
          }
        />
        <Row
          title={t('prefs.general.trayIcon')}
          description={t('prefs.general.trayIconHint')}
          controlId="pref-tray"
          control={
            <Select
              id="pref-tray"
              value={settings.trayIconStyle}
              options={[
                ['template', t('prefs.general.trayTemplate')],
                ['brand', t('prefs.general.trayBrand')],
                ['black', t('prefs.general.trayBlack')],
              ]}
              onChange={(trayIconStyle) => void commit({ trayIconStyle })}
            />
          }
        />
      </Group>

      <Group title={t('prefs.general.configTitle')}>
        <Row
          title={t('prefs.general.export')}
          description={t('prefs.general.exportHint')}
          control={
            <Button
              onClick={() =>
                void api
                  .exportConfig()
                  .then((path) => {
                    setConfigPath(path)
                    setConfigNotice(t('prefs.general.exported', { path }))
                  })
                  .catch((error: unknown) => setConfigNotice(String(error)))
              }
            >
              {t('prefs.general.exportAction')}
            </Button>
          }
        />
        <Row
          title={t('prefs.general.import')}
          description={configNotice ?? t('prefs.general.importHint')}
          control={
            <>
              {/* 路径不是设置项，不走「失焦才提交」：按钮要随着输入立刻可点 */}
              <input
                aria-label={t('prefs.general.importPath')}
                className="pref-input w-48"
                placeholder={t('prefs.general.importPath')}
                value={configPath}
                spellCheck={false}
                onChange={(event) => setConfigPath(event.target.value)}
              />
              <Button
                disabled={configPath.trim() === ''}
                onClick={() =>
                  void api
                    .importConfig(configPath.trim())
                    .then(async (summary) => {
                      await onImported()
                      setConfigNotice(importNotice(summary, t))
                    })
                    .catch((error: unknown) => setConfigNotice(String(error)))
                }
              >
                {t('prefs.general.importAction')}
              </Button>
            </>
          }
        />
      </Group>
    </div>
  )
}

/**
 * 导入结果的说明。端点与取词黑名单的变化单独列出：前者决定 API Key 发往哪里，
 * 后者决定哪些应用里的选中内容会被读取——一份别人分享的配置不该悄悄改掉它们。
 */
function importNotice(summary: ImportSummary, t: Translate): string {
  const parts = [
    t('prefs.general.imported', {
      version: summary.bundleVersion,
      styles: summary.customStyleCount,
      glossaries: summary.glossaryCount,
    }),
  ]
  if (summary.endpointChanges.length > 0) {
    const list = summary.endpointChanges
      .map(([id, url]) => `${id} → ${url || t('prefs.general.importedEndpointDefault')}`)
      .join(', ')
    parts.push(t('prefs.general.importedEndpoints', { list }))
  }
  if (summary.blacklistAdded.length > 0) {
    parts.push(
      t('prefs.general.importedBlacklistAdded', { list: summary.blacklistAdded.join(', ') }),
    )
  }
  if (summary.blacklistRemoved.length > 0) {
    parts.push(
      t('prefs.general.importedBlacklistRemoved', { list: summary.blacklistRemoved.join(', ') }),
    )
  }
  return parts.join(' ')
}
