import type { ReactNode } from 'react'

import type { Translate } from '../lib/i18n'
import { api } from '../lib/ipc'
import { Button } from './ui'

/**
 * 权限：每一项都如实显示状态，并能「重新检查」——用户多半是从系统设置切回来的，
 * 窗口重新获得焦点时外层也会自动再查一次。
 *
 * 麦克风不在这里：现在没有任何功能用到它，等听写做出来再加。
 */
export function PermissionsPage({
  t,
  accessibility,
  screenRecording,
  onRecheck,
}: {
  t: Translate
  accessibility: boolean | null
  screenRecording: boolean | null
  onRecheck: () => Promise<void>
}) {
  return (
    <div className="space-y-3">
      <PermissionCard
        t={t}
        title={t('prefs.permissions.accessibility')}
        description={t('prefs.permissions.accessibilityHint')}
        granted={accessibility}
        actions={
          <Button onClick={() => void api.openAccessibilitySettings()}>
            {t('prefs.permissions.openSettings')}
          </Button>
        }
        onRecheck={onRecheck}
      />
      <PermissionCard
        t={t}
        title={t('prefs.permissions.screen')}
        description={t('prefs.permissions.screenHint')}
        granted={screenRecording}
        actions={
          <>
            <Button onClick={() => void api.ocrRequestPermission().then(() => onRecheck())}>
              {t('prefs.permissions.request')}
            </Button>
            <Button onClick={() => void api.openScreenRecordingSettings()}>
              {t('prefs.permissions.openSettings')}
            </Button>
          </>
        }
        onRecheck={onRecheck}
      />
    </div>
  )
}

function PermissionCard({
  t,
  title,
  description,
  granted,
  actions,
  onRecheck,
}: {
  t: Translate
  title: string
  description: string
  granted: boolean | null
  actions: ReactNode
  onRecheck: () => Promise<void>
}) {
  const state =
    granted === null
      ? {
          text: t('prefs.permissions.unknown'),
          color: 'text-text-tertiary',
          dot: 'bg-text-tertiary',
        }
      : granted
        ? { text: t('prefs.permissions.granted'), color: 'text-success', dot: 'bg-success' }
        : { text: t('prefs.permissions.missing'), color: 'text-warning', dot: 'bg-warning' }

  return (
    <section className="pref-card px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-text-primary">{title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-text-tertiary">{description}</p>
        </div>
        <span className={`flex shrink-0 items-center gap-1.5 text-xs ${state.color}`}>
          <span className={`inline-block size-1.5 rounded-full ${state.dot}`} />
          {state.text}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {!granted && actions}
        <Button onClick={() => void onRecheck()}>{t('prefs.permissions.recheck')}</Button>
      </div>
    </section>
  )
}
