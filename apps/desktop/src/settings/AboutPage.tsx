import appIcon from '../assets/app-icon.png'
import type { Translate } from '../lib/i18n'
import { api } from '../lib/ipc'
import { Group, LinkRowButton, Row } from './ui'

const SITE_URL = 'https://umuo.app'
const FEEDBACK_URL = 'mailto:hello@umuo.app'

/** 关于：版本、更新方式、外链。客户端还没有自动更新，如实说「去官网下载」。 */
export function AboutPage({ t, appVersion }: { t: Translate; appVersion: string | null }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-1 pt-2 pb-1 text-center">
        <img src={appIcon} alt="" className="size-16" />
        <p className="text-base font-semibold text-text-primary">umuo</p>
        <p className="text-xs text-text-tertiary">
          {t('prefs.about.version', { version: appVersion ?? t('prefs.about.versionUnknown') })}
        </p>
      </div>

      <Group title={t('prefs.about.updates')}>
        <Row
          title={t('prefs.about.checkUpdates')}
          description={t('prefs.about.checkUpdatesHint')}
          control={
            <LinkRowButton
              external
              label={t('prefs.about.website')}
              onClick={() => void api.openExternal(SITE_URL)}
            />
          }
        />
      </Group>

      <Group title={t('prefs.about.links')}>
        <Row
          title={t('prefs.about.feedback')}
          description={t('prefs.about.feedbackHint')}
          control={
            <LinkRowButton
              external
              label={t('prefs.about.feedback')}
              onClick={() => void api.openExternal(FEEDBACK_URL)}
            />
          }
        />
        <Row
          title={t('prefs.about.website')}
          control={
            <LinkRowButton
              external
              label={t('prefs.about.website')}
              onClick={() => void api.openExternal(SITE_URL)}
            />
          }
        />
      </Group>

      <Group title={t('prefs.about.data')}>
        <Row title={t('prefs.about.dataLocal')} description={t('prefs.about.dataLocalHint')} />
      </Group>
    </div>
  )
}
