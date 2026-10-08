import type { SiteContent } from '../content/types'
import { Section } from './Section'

/**
 * BYOK 专区：三点承诺（Keychain / 直连厂商 / 本地离线模型）、一次请求的走向、
 * 以及按 PRD §10.3 成本口径写成的费用估算。这里不放任何架构示意图，
 * 用文字化流程替代，避免出现没有素材来源的假截图。
 */
export function ByokSection({ content }: { content: SiteContent }) {
  const { byok } = content

  return (
    <Section id="byok" title={byok.title} description={byok.description}>
      <ul className="byok-points grid gap-8 md:grid-cols-3">
        {byok.points.map((point) => (
          <li key={point.title}>
            <h3 className="font-heading text-base font-semibold text-text-primary">
              {point.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{point.description}</p>
          </li>
        ))}
      </ul>
      <p className="mt-10 text-text-secondary">
        <span className="font-medium text-text-primary">{byok.costTitle}</span>{' '}
        {byok.costRows.at(-1)?.value}
      </p>
    </Section>
  )
}
