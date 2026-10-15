import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 防止把 Markdown 的强调语法写进 JSX 文本。
 *
 * 这个错误在本仓库犯过**三次**（词卡朗读、术语表说明、首次引导），每次都表现成
 * 「界面里直接显示 `**只参与请求头**` 这样的星号」——构建绿、lint 绿、type-check 绿，
 * 只有把渲染结果读出来才看得见。所以用一条测试把它变成不可能。
 *
 * 规则很简单：**JSX 文本里不该出现 `**`**。
 * 注释（`//`、`/* *\/`、`*` 开头的文档行）跳过——那里写 Markdown 是正常的。
 */
function offendingLines(source: string): string[] {
  const offenders: string[] = []
  let inBlockComment = false

  source.split('\n').forEach((line, index) => {
    const trimmed = line.trim()

    // 块注释的进出（含 JSDoc）
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false
      return
    }
    // `/*`（含 JSDoc）与 `{/*`（JSX 注释）都不算 JSX 文本。
    if (trimmed.startsWith('/*') || trimmed.startsWith('{/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true
      return
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return

    // 行尾的行注释也去掉，避免把注释里的 Markdown 当成 JSX 文本。
    const withoutLineComment = line.replace(/\/\/.*$/, '')
    if (withoutLineComment.includes('**')) {
      offenders.push(`${index + 1}: ${trimmed.slice(0, 80)}`)
    }
  })

  return offenders
}

describe('JSX 文本里不要写 Markdown 强调', () => {
  it('所有客户端界面源码都不含裸露的 **', () => {
    const files = globSync('apps/desktop/src/**/*.tsx')
    expect(files.length).toBeGreaterThan(5)

    const problems: string[] = []
    for (const file of files) {
      for (const line of offendingLines(readFileSync(file, 'utf8'))) {
        problems.push(`${file} → ${line}`)
      }
    }
    expect(
      problems,
      `JSX 里的 ** 会被原样渲染成星号。用 <strong> 代替：\n${problems.join('\n')}`,
    ).toEqual([])
  })

  it('这条规则本身能抓到问题（否则它只是装饰）', () => {
    const bad = offendingLines(`export function A() {\n  return <p>**粗体**</p>\n}`)
    expect(bad).toHaveLength(1)

    const fine = offendingLines(
      [
        '// 行注释里的 ** 不算',
        '/**',
        ' * 文档注释里的 ** 也不算',
        ' */',
        '{/*',
        '  JSX 注释里的 ** 同样不算（它不会被渲染）',
        '*/}',
        'export const x = { a: 1 }',
      ].join('\n'),
    )
    expect(fine).toEqual([])
  })
})
