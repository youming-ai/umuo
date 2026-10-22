/**
 * 读写 wrangler.jsonc 里 `vars` 的字符串值（scripts/waffo-setup.ts 用）。
 *
 * 按行改写而不是 JSON.parse → JSON.stringify：后者会丢掉文件里的全部注释。
 * 约定每个变量独占一行 `"NAME": "值",`；`// "NAME": "…",`（注释掉的占位）也认，写入时去掉注释。
 * 被注释掉的行读出来是 null：只有真正生效的值才算「已有」。
 */

/** 变量名只允许 `\w`，直接拼进正则也安全 */
const checked = (name: string) => {
  if (!/^\w+$/.test(name)) throw new Error(`变量名不合法：${name}`)
  return name
}

export function readVar(jsonc: string, name: string): string | null {
  return (
    jsonc.match(new RegExp(`^\\s*"${checked(name)}"\\s*:\\s*"([^"]+)"\\s*,?\\s*$`, 'm'))?.[1] ??
    null
  )
}

export function writeVar(jsonc: string, name: string, value: string): string {
  if (!/^[\w-]+$/.test(value)) throw new Error(`${name} 的值不像一个 ID：${value}`)
  const line = new RegExp(`^(\\s*)(?:\\/\\/ ?)?"${checked(name)}"\\s*:\\s*"[^"]*"(,?)[ \\t]*$`, 'm')
  if (!line.test(jsonc)) throw new Error(`wrangler.jsonc 里找不到 ${name} 这一行`)
  return jsonc.replace(
    line,
    (_match, indent: string, comma: string) => `${indent}"${name}": "${value}"${comma}`,
  )
}
