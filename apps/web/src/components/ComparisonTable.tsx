import type { SiteContent } from '../content/types'
import { Section } from './Section'

/**
 * 对比表。列与行都来自 PRD §2.5 的竞品分析，措辞客观；
 * 首列之外的第一列是 umuo，用背景色区分。
 */
export function ComparisonTable({ content }: { content: SiteContent }) {
  const { comparison } = content

  return (
    <Section id="comparison" title={comparison.title} description={comparison.description}>
      {/* 窄屏可横向滚动；桌面宽度下表格本身放得下 */}
      <div className="comparison-scroll overflow-x-auto">
        <table className="w-full min-w-3xl border-collapse text-left align-top text-sm">
          <caption className="sr-only">{comparison.title}</caption>
          <thead>
            <tr>
              {comparison.columns.map((column) => (
                <th
                  key={column || 'row-label'}
                  scope="col"
                  className={[
                    'border-border-muted border-b px-4 py-3 font-heading text-sm font-semibold text-text-primary',
                    column === 'umuo' ? 'bg-background-secondary' : '',
                  ].join(' ')}
                >
                  {column || <span className="sr-only">{comparison.label}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <tr key={row.label} className="border-border-muted border-b last:border-b-0">
                <th scope="row" className="px-4 py-4 font-medium text-text-secondary">
                  {row.label}
                </th>
                {row.values.map((value, index) => (
                  <td
                    key={comparison.columns[index + 1] ?? String(index)}
                    className={[
                      'px-4 py-4 leading-relaxed',
                      index === 0
                        ? 'bg-background-secondary text-text-primary'
                        : 'text-text-secondary',
                    ].join(' ')}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-sm text-text-tertiary">{comparison.footnote}</p>
    </Section>
  )
}
