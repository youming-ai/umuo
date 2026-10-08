import type { SiteContent } from '../content/types'
import { Section } from './Section'

/** 常见问题：用原生 details/summary，键盘与读屏都免费可用 */
export function Faq({ content }: { content: SiteContent }) {
  const { faq } = content

  return (
    <Section id="faq" title={faq.title} description={faq.description}>
      <div className="faq-list">
        {faq.items.map((item) => (
          <details key={item.question} className="group py-5">
            <summary className="flex cursor-pointer items-start justify-between gap-6 font-heading text-base font-medium text-text-primary">
              {item.question}
              <span
                aria-hidden="true"
                className="text-lg leading-none text-text-tertiary transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-4 text-sm leading-relaxed text-text-secondary">{item.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  )
}
