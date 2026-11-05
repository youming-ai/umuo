import { describe, expect, it } from 'vitest'

import { replaceLiteral } from '../lib/html'

describe('replaceLiteral', () => {
  it("替换内容里的 $& / $` / $' / $$ 按原文插入，不当成替换模式展开", () => {
    const html = '<body><div id="root"></div></body>'
    const body = "价格 $& 与 $` 与 $' 与 $$"
    expect(replaceLiteral(html, '<div id="root"></div>', `<div id="root">${body}</div>`)).toBe(
      `<body><div id="root">${body}</div></body>`,
    )
  })

  it('正则查找时替换内容同样按原文插入', () => {
    const html = '<!-- seo:start -->旧<!-- seo:end -->'
    expect(
      replaceLiteral(html, /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, '<title>$1 $&</title>'),
    ).toBe('<title>$1 $&</title>')
  })
})
