import type { SiteContent } from '../content/types'
import { Section } from './Section'

/** 快捷键速查卡：只列四个主键位，其余的留给设置页和文档。 */
export function ShortcutBar({ content }: { content: SiteContent }) {
  const { shortcuts } = content

  return (
    <Section id="shortcuts" title={shortcuts.title} description={shortcuts.description}>
      <ul className="shortcut-card">
        {shortcuts.items.map((row) => (
          <li key={row.name}>
            <span className="flex gap-1">
              {row.keys.map((key) => (
                <kbd key={key} className="keycap keycap-sm">
                  {key}
                </kbd>
              ))}
            </span>
            <span className="font-medium text-text-primary">{row.name}</span>
            <span className="text-text-secondary">{row.description}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-text-tertiary">{shortcuts.extraNote}</p>
    </Section>
  )
}
