import type { SiteContent } from '../content/types'
import { Section } from './Section'

/** 更多功能：只列名字，一行排开。 */
export function FeatureGrid({ content }: { content: SiteContent }) {
  const { features } = content

  return (
    <Section id="more" title={features.title} description={features.description}>
      <ul className="provider-list">
        {features.items.map((item) => (
          <li key={item.title}>{item.title}</li>
        ))}
      </ul>
    </Section>
  )
}
