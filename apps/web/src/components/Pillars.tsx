import { getContent } from '../content'
import type { Locale, PillarId, SiteContent } from '../content/types'
import { DEMO_SOURCE } from './Hero'

const KEYS: Record<PillarId, string[]> = { read: ['⌥', 'D'], write: ['⌥', 'A'], look: ['⌥', 'S'] }

/**
 * 「读 / 写 / 看」排成对照本：页边是另一种语言的同名标题（英文；英文页则配简体中文），
 * 正文只有标题和一句话，右栏是这件事的一个原文 / 译文例子。
 * 页边那栏是装饰性的复述，对读屏隐藏，免得每个标题读两遍。
 */
export function Pillars({ content, locale }: { content: SiteContent; locale: Locale }) {
  const pairLocale: Locale = locale === 'en' ? 'zh-cn' : 'en'
  const pair = getContent(pairLocale).pillars

  return (
    <section id="features" aria-label={content.nav.links[0]?.label} className="container-page">
      <ul className="pillars">
        {content.pillars.map((pillar, index) => {
          const titleId = `pillar-${pillar.id}-title`
          return (
            <li key={pillar.id} className="pillar">
              <p lang={pairLocale} aria-hidden="true" className="pillar-pair">
                <span className="block">{pair[index]?.label}</span>
                {pair[index]?.title}
              </p>
              <section aria-labelledby={titleId}>
                <p className="pillar-glyph" aria-hidden="true">
                  {pillar.label}
                </p>
                <h2 id={titleId} className="section-title-sm mt-3">
                  {pillar.title}
                </h2>
                <p className="mt-2 text-text-secondary">{pillar.description}</p>
              </section>
              <PillarExample id={pillar.id} translation={content.hero.demo.translation} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** 每件事一个最小例子：原文是无衬线，译文是宋体，和首屏同一套记号。 */
function PillarExample({ id, translation }: { id: PillarId; translation: string }) {
  const source = (
    <p lang="en" className="source-text">
      {id === 'read' ? <mark className="selection">{DEMO_SOURCE}</mark> : DEMO_SOURCE}
    </p>
  )
  const target = <p className="translation-text">{translation}</p>

  return (
    <div className="pillar-example" aria-hidden="true">
      <div className="mb-4 flex gap-1">
        {KEYS[id].map((key) => (
          <kbd key={key} className="keycap keycap-sm">
            {key}
          </kbd>
        ))}
      </div>
      {id === 'read' ? (
        <>
          {source}
          <div className="mt-3">{target}</div>
        </>
      ) : null}
      {id === 'write' ? (
        <>
          {target}
          <div className="mt-3">{source}</div>
        </>
      ) : null}
      {id === 'look' ? (
        <>
          <div className="capture">{source}</div>
          <div className="mt-3">{target}</div>
        </>
      ) : null}
    </div>
  )
}
