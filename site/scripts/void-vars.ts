/**
 * 读写 void.config.ts 的 worker.vars（scripts/waffo-setup.ts 用）。
 * 每个变量独占一行；按行改写以保留 TypeScript 配置里的其余字段和注释。
 */

const checked = (name: string) => {
  if (!/^\w+$/.test(name)) throw new Error(`变量名不合法：${name}`)
  return name
}

export function readVar(config: string, name: string): string | null {
  return (
    config.match(new RegExp(`^\\s*${checked(name)}\\s*:\\s*'([^']+)'\\s*,?\\s*$`, 'm'))?.[1] ?? null
  )
}

export function writeVar(config: string, name: string, value: string): string {
  if (!/^[\w-]+$/.test(value)) throw new Error(`${name} 的值不像一个 ID：${value}`)
  const line = new RegExp(`^(\\s*)(?:\\/\\/ ?)?${checked(name)}\\s*:\\s*'[^']*'(,?)[ \\t]*$`, 'm')
  if (!line.test(config)) throw new Error(`void.config.ts 里找不到 ${name} 这一行`)
  return config.replace(
    line,
    (_match, indent: string, comma: string) => `${indent}${name}: '${value}'${comma}`,
  )
}
