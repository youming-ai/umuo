import { useRef, useState } from 'react'

import { SceneRouting } from '../components/SceneRouting'
import { api, type ProviderInfo } from '../lib/ipc'
import type { PageProps } from './types'
import { Button, DraftInput, Group, Row, Select } from './ui'

/**
 * 引擎：自带 Key 的供应商、模型与分场景路由。
 *
 * **Key 只出不进**：输入框永远不回填明文，只显示「已配置」；而且 Key **不走改了就存**——
 * 它是密钥，必须由用户明确按下「保存」才写进 Keychain。
 */
export function EnginePage({
  settings,
  commit,
  t,
  providers,
  keyConfigured,
  onKeyConfigured,
}: PageProps & {
  providers: ProviderInfo[]
  keyConfigured: boolean | null
  onKeyConfigured: (configured: boolean, providerId: string) => void
}) {
  const provider = providers.find((p) => p.id === settings.providerId)
  const [apiKey, setApiKey] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [modelNotice, setModelNotice] = useState<string | null>(null)
  const [endpointError, setEndpointError] = useState<string | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)
  // 当前选中的供应商。异步结果（Key 状态、模型列表、保存 Key）回来时供应商可能已经换了，
  // 用它判断结果是否还作数——否则旧供应商的结果会盖到新供应商头上。
  const active = useRef(settings.providerId)
  active.current = settings.providerId

  const switchProvider = async (providerId: string) => {
    const next = providers.find((p) => p.id === providerId)
    active.current = providerId
    // 没保存的 Key 草稿属于上一个供应商：不清掉的话，按「保存」会把它存到新供应商名下。
    setApiKey('')
    setKeyError(null)
    setModels([])
    setModelNotice(null)
    await commit({ providerId, model: next?.defaultModel ?? '' })
    const configured = await api.keyStatus(providerId)
    if (active.current === providerId) onKeyConfigured(configured, providerId)
  }

  const fetchModels = async () => {
    const requested = settings.providerId
    setModelNotice(null)
    try {
      const list = await api.listModels(requested)
      if (active.current !== requested) return
      setModels(list)
      setModelNotice(
        list.length > 0
          ? t('prefs.engine.gotModels', { count: list.length })
          : t('prefs.engine.noModels'),
      )
    } catch (error) {
      if (active.current !== requested) return
      setModelNotice(t('prefs.engine.fetchModelsFailed', { reason: String(error) }))
    }
  }

  return (
    <div className="space-y-6">
      <p className="px-1 text-xs leading-relaxed text-text-tertiary">{t('prefs.engine.intro')}</p>

      <Group title={t('prefs.engine.default')}>
        <Row
          title={t('prefs.engine.provider')}
          description={provider?.local ? t('prefs.engine.localHint') : undefined}
          controlId="pref-provider"
          control={
            <Select
              id="pref-provider"
              value={settings.providerId}
              options={providers.map((p) => [
                p.id,
                p.local ? t('prefs.engine.localLabel', { name: p.label }) : p.label,
              ])}
              onChange={(providerId) => void switchProvider(providerId)}
            />
          }
        />

        {provider?.requiresKey && (
          <Row
            title={t('prefs.engine.apiKey')}
            description={
              keyConfigured ? t('prefs.engine.keyConfigured') : t('prefs.engine.keyMissing')
            }
            controlId="pref-api-key"
            error={keyError}
            control={
              <>
                <input
                  id="pref-api-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  className="pref-input w-48"
                  placeholder={
                    keyConfigured ? t('prefs.engine.keyKeep') : t('prefs.engine.keyPaste')
                  }
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <Button
                  disabled={apiKey.trim() === ''}
                  onClick={() => {
                    const providerId = settings.providerId
                    setKeyError(null)
                    void api
                      .saveApiKey(providerId, apiKey.trim())
                      .then(() => {
                        if (active.current !== providerId) return
                        setApiKey('')
                        onKeyConfigured(true, providerId)
                      })
                      .catch((error: unknown) => setKeyError(String(error)))
                  }}
                >
                  {t('prefs.engine.keySave')}
                </Button>
                {keyConfigured && (
                  <Button
                    tone="danger"
                    onClick={() => {
                      const providerId = settings.providerId
                      void api
                        .deleteApiKey(providerId)
                        .then(() => {
                          if (active.current === providerId) onKeyConfigured(false, providerId)
                        })
                        .catch((error: unknown) => setKeyError(String(error)))
                    }}
                  >
                    {t('prefs.engine.keyClear')}
                  </Button>
                )}
              </>
            }
          >
            {provider.keysUrl && (
              <button
                type="button"
                className="text-xs text-primary underline"
                onClick={() => void api.openExternal(provider.keysUrl)}
              >
                {t('prefs.engine.getKey', { name: provider.label })}
              </button>
            )}
          </Row>
        )}

        {provider?.id === 'azure' && (
          <Row
            title={t('prefs.engine.azureEndpoint')}
            description={t('prefs.engine.azureEndpointHint')}
            controlId="pref-azure"
            error={endpointError}
            control={
              <DraftInput
                id="pref-azure"
                width="w-64"
                placeholder="https://<name>.openai.azure.com"
                value={settings.providerBaseUrls?.azure ?? ''}
                onError={setEndpointError}
                onCommit={(azure) =>
                  commit({ providerBaseUrls: { ...(settings.providerBaseUrls ?? {}), azure } })
                }
              />
            }
          />
        )}

        {provider?.id === 'custom' && (
          <Row
            title={t('prefs.engine.customBaseUrl')}
            description={t('prefs.engine.customBaseUrlHint')}
            controlId="pref-custom-base"
            error={endpointError}
            control={
              <DraftInput
                id="pref-custom-base"
                width="w-64"
                placeholder="https://gateway.internal/v1"
                value={settings.customBaseUrl}
                onError={setEndpointError}
                onCommit={(customBaseUrl) => commit({ customBaseUrl })}
              />
            }
          />
        )}

        <Row
          title={t('prefs.engine.model')}
          description={
            modelNotice ??
            (provider?.id === 'azure'
              ? t('prefs.engine.modelAzureHint')
              : t('prefs.engine.modelHint'))
          }
          controlId="pref-model"
          error={modelError}
          control={
            <>
              <DraftInput
                id="pref-model"
                width="w-48"
                list="pref-models"
                placeholder={provider?.defaultModel}
                value={settings.model}
                onError={setModelError}
                onCommit={(model) => commit({ model })}
              />
              <datalist id="pref-models">
                {(models.length > 0 ? models : (provider?.suggestedModels ?? [])).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <Button onClick={() => void fetchModels()}>{t('prefs.engine.fetchModels')}</Button>
            </>
          }
        />
      </Group>

      <Group>
        <Row title={t('prefs.engine.routing')} description={t('prefs.engine.routingHint')}>
          <SceneRouting
            settings={settings}
            providers={providers}
            onUpdate={(patch) => void commit(patch)}
            t={t}
          />
        </Row>
      </Group>
    </div>
  )
}
