import { useState } from 'react'

import { usageLine } from '../lib/history-format'
import {
  api,
  type LimitAction,
  type ProviderInfo,
  type ProviderUsage,
  type Usage,
} from '../lib/ipc'
import { limitFor, limitSummary, parseLimit, setLimit, spendFor } from '../lib/limits'
import type { PageProps } from './types'
import { DraftInput, Group, LinkRowButton, Row, Select, Toggle } from './ui'

export function AdvancedPage({
  settings,
  commit,
  t,
  providers,
  usage,
  spend,
}: PageProps & {
  providers: ProviderInfo[]
  usage: Usage | null
  spend: ProviderUsage[]
}) {
  const [proxyError, setProxyError] = useState<string | null>(null)
  // 「自定义」要连同地址一起才是合法设置（后端会拒绝空地址）。所以选中它时只在本地展开地址栏，
  // 等地址填好再把模式和地址一起保存；否则保存失败、模式被退回，地址栏也就永远出不来。
  const [pendingCustom, setPendingCustom] = useState(false)
  const proxyMode = pendingCustom ? 'custom' : settings.proxyMode
  const [retentionError, setRetentionError] = useState<string | null>(null)
  const [limitError, setLimitError] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <Group title={t('prefs.advanced.network')}>
        <Row
          title={t('prefs.advanced.proxy')}
          description={t('prefs.advanced.proxyHint')}
          controlId="pref-proxy-mode"
          control={
            <Select
              id="pref-proxy-mode"
              value={proxyMode}
              options={[
                ['system', t('prefs.followSystem')],
                ['none', t('prefs.advanced.proxyNone')],
                ['custom', t('prefs.advanced.proxyCustom')],
              ]}
              onChange={(next) => {
                setProxyError(null)
                // 之前存过地址：直接切过去（地址不合法时保存失败、在这一行显示原因）。
                // 没存过：先展开地址栏，等地址填好一起保存。
                if (
                  next === 'custom' &&
                  settings.proxyMode !== 'custom' &&
                  settings.proxyUrl.trim() === ''
                ) {
                  setPendingCustom(true)
                  return
                }
                setPendingCustom(false)
                if (next !== settings.proxyMode)
                  commit({ proxyMode: next }).catch((error: unknown) =>
                    setProxyError(String(error)),
                  )
              }}
            />
          }
        />
        {proxyMode === 'custom' && (
          <Row
            title={t('prefs.advanced.proxyUrl')}
            description={t('prefs.advanced.proxyUrlHint')}
            controlId="pref-proxy-url"
            error={proxyError}
            control={
              <DraftInput
                id="pref-proxy-url"
                width="w-56"
                placeholder="socks5://127.0.0.1:1080"
                value={settings.proxyUrl}
                onError={setProxyError}
                onCommit={(proxyUrl) =>
                  commit({ proxyMode: 'custom', proxyUrl }).then(() => setPendingCustom(false))
                }
              />
            }
          />
        )}
      </Group>

      <Group title={t('prefs.advanced.usage')}>
        <Row title={t('prefs.advanced.usageThisMonth')} description={usageLine(usage, t)} />
        <Row
          title={t('prefs.advanced.limitAction')}
          description={t('prefs.advanced.limitActionHint')}
          controlId="pref-limit-action"
          control={
            <Select<LimitAction>
              id="pref-limit-action"
              value={settings.limitAction}
              options={[
                ['warn', t('prefs.advanced.limitWarn')],
                ['failover', t('prefs.advanced.limitFailover')],
              ]}
              onChange={(limitAction) => void commit({ limitAction })}
            />
          }
        />
        <Row
          title={t('prefs.advanced.limits')}
          description={t('prefs.advanced.limitsHint')}
          error={limitError}
        >
          <div className="space-y-1.5">
            {providers.map((provider) => {
              const limit = limitFor(settings.monthlyLimits, provider.id)
              const spent = spendFor(spend, provider.id)
              const over = limit !== null && spent >= limit
              return (
                <div key={provider.id} className="flex items-center gap-2">
                  <span className="w-28 truncate text-xs text-text-primary">{provider.label}</span>
                  <span
                    className={`flex-1 text-[11px] ${over ? 'text-warning' : 'text-text-tertiary'}`}
                  >
                    {limitSummary(limit, spent, t)}
                  </span>
                  <DraftInput
                    type="number"
                    width="w-24"
                    label={t('prefs.advanced.limitFor', { name: provider.label })}
                    placeholder={t('prefs.advanced.unlimited')}
                    value={limit === null ? '' : String(limit)}
                    onError={setLimitError}
                    onCommit={(text) =>
                      commit({
                        monthlyLimits: setLimit(
                          settings.monthlyLimits,
                          provider.id,
                          parseLimit(text),
                        ),
                      })
                    }
                  />
                </div>
              )
            })}
          </div>
        </Row>
      </Group>

      <Group title={t('prefs.advanced.history')}>
        <Row
          title={t('prefs.advanced.historyEnabled')}
          description={t('prefs.advanced.historyEnabledHint')}
          control={
            <Toggle
              label={t('prefs.advanced.historyEnabled')}
              checked={settings.historyEnabled}
              onChange={(historyEnabled) => void commit({ historyEnabled })}
            />
          }
        />
        <Row
          title={t('prefs.advanced.privacy')}
          description={t('prefs.advanced.privacyHint')}
          control={
            <Toggle
              label={t('prefs.advanced.privacy')}
              checked={settings.privacyMode}
              onChange={(privacyMode) => void commit({ privacyMode })}
            />
          }
        />
        <Row
          title={t('prefs.advanced.retention')}
          description={t('prefs.advanced.retentionHint')}
          controlId="pref-retention"
          error={retentionError}
          control={
            <DraftInput
              id="pref-retention"
              type="number"
              width="w-20"
              value={String(settings.historyRetentionDays)}
              onError={setRetentionError}
              onCommit={(text) => {
                // 负数与 NaN 都归 0（不清理）——传下去只会让清理逻辑算出未来的时间点。
                const parsed = Number.parseInt(text, 10)
                return commit({
                  historyRetentionDays: Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
                })
              }}
            />
          }
        />
        <Row
          title={t('prefs.advanced.openHistory')}
          control={
            <LinkRowButton
              label={t('prefs.advanced.openHistory')}
              onClick={() => void api.openHistory()}
            />
          }
        />
      </Group>
    </div>
  )
}
