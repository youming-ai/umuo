import type { ReactNode } from 'react'
import type { LegalDoc } from '../content/types'

/** 正文里的网址与邮箱：网址只取 ASCII 字符（韩文助词、全角标点紧贴在后面也不会吞进去），句末的点另行剥掉 */
const LINK = /(https?:\/\/[\w\-./?#=&%~+:]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g

/** 把条款正文里的网址与邮箱渲染成可点的链接；其余原样输出。纯函数，预渲染与 hydration 结果一致 */
function linkify(text: string): ReactNode[] {
  return text.split(LINK).map((part, index) => {
    if (index % 2 === 0) return part
    const trimmed = part.replace(/[.,]+$/, '')
    const rest = part.slice(trimmed.length)
    const href =
      trimmed.includes('@') && !trimmed.startsWith('http') ? `mailto:${trimmed}` : trimmed
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: 同一段文字切出来的片段，顺序固定
      <span key={index}>
        <a href={href}>{trimmed}</a>
        {rest}
      </span>
    )
  })
}

/** 服务条款 / 隐私政策：纯文本排版，正文块的约定见 LegalBlock */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <article className="legal container-page">
      <h1 className="section-title">{doc.title}</h1>
      <p className="legal-meta">{doc.meta}</p>
      {doc.intro?.map((paragraph) => (
        <p key={paragraph}>{linkify(paragraph)}</p>
      ))}
      {doc.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.body.map((block, index) =>
            typeof block === 'string' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: 静态文案，顺序不变
              <p key={index}>{linkify(block)}</p>
            ) : Array.isArray(block) ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: 同上
              <ul key={index}>
                {block.map((item) => (
                  <li key={item}>{linkify(item)}</li>
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
