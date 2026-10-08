import type { SiteContent } from '../content/types'
import { Section } from './Section'

/** 支持的供应商：一行行排开的名字，不做跑马灯，所有设备上一眼看全。 */
export function LogoWall({ content }: { content: SiteContent }) {
  const { logoWall } = content

  return (
    <Section id="models" title={logoWall.title} description={logoWall.description}>
      <ul aria-label={logoWall.title} className="provider-list">
        {logoWall.providers.map((provider) => (
          <li key={provider}>{provider}</li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-text-tertiary">{logoWall.footnote}</p>
    </Section>
  )
}
