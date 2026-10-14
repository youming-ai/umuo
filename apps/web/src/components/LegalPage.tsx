import type { LegalDoc } from '../content/types'

/** 服务条款 / 隐私政策：纯文本排版，正文块的约定见 LegalBlock */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <article className="legal container-page">
      <h1 className="section-title">{doc.title}</h1>
      <p className="legal-meta">{doc.meta}</p>
      {doc.intro?.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {doc.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.body.map((block, index) =>
            typeof block === 'string' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: 静态文案，顺序不变
              <p key={index}>{block}</p>
            ) : Array.isArray(block) ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: 同上
              <ul key={index}>
                {block.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <h3 key={block.heading}>{block.heading}</h3>
            ),
          )}
        </section>
      ))}
    </article>
  )
}
