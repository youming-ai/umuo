import type { Translate } from '../lib/i18n'
import type { Settings } from '../lib/ipc'

/** 每个分区页都拿到的东西：当前设置、改了就存的入口、文案函数。 */
export interface PageProps {
  settings: Settings
  commit: (patch: Partial<Settings>) => Promise<void>
  t: Translate
}
