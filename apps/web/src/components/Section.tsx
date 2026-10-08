import type { ReactNode } from 'react'

interface SectionProps {
  id: string
  title: string
  description: string
  children: ReactNode
  className?: string
}

/** 全站统一的区块外壳：像书的章首，左边标题、右边一句描述，下面是内容。标题通过 aria-labelledby 关联。 */
export function Section({ id, title, description, children, className }: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={['landing-section', className].filter(Boolean).join(' ')}
    >
      <div className="container-page">
        <header className="section-heading">
          <h2 id={`${id}-title`} className="section-title">
            {title}
          </h2>
          <p className="lead">{description}</p>
        </header>
        <div className="section-body mt-12">{children}</div>
      </div>
    </section>
  )
}
