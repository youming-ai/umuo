import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 生成随 umuo.app 分发的 Rust 依赖许可声明（Contents/Resources/Licenses/rust-crates.txt）。
 *
 * 范围：`cargo tree -p umuo-ffi -e normal,no-proc-macro` 在 aarch64-apple-darwin 上列出的 crate，即编进
 * 静态库的普通依赖；dev / build 依赖与 proc-macro 只在编译期运行，不进二进制，不列。
 * 每个 crate 收全发布包根目录里的 LICENSE / COPYING / NOTICE / UNLICENSE 文件；没带许可文件的 crate
 * 只在 SPDX 表达式能落到本仓库收录的标准原文时回落，否则报错，不静默跳过。
 * 输出确定：按 crate 名与版本排序，同一份许可原文只印一次，不含时间戳与本机路径。
 */

export interface CargoMetadata {
  packages: Array<{
    id: string
    name: string
    version: string
    license: string | null
    repository: string | null
    source: string | null
    manifest_path: string
  }>
}

export interface Crate {
  name: string
  version: string
  license: string
  repository: string
  dir: string
}

/**
 * 解析 `cargo tree --prefix none --format '{p}'` 的输出，得到 `name@version` 集合。
 * crate 集合以 cargo tree 为准：cargo metadata 的 resolve 不按 feature 精确裁剪，会多出没编进去的可选依赖。
 */
export function parseTree(output: string): Set<string> {
  const ids = new Set<string>()
  for (const line of output.split('\n')) {
    const match = /^(\S+) v(\S+)/.exec(line.trim())
    if (match) ids.add(`${match[1]}@${match[2]}`)
  }
  return ids
}

/** 按 cargo tree 给出的集合从 metadata 取第三方 crate（不含工作区自身的包），按名称、版本排序。 */
export function linkedCrates(meta: CargoMetadata, linked: Set<string>): Crate[] {
  const crates = meta.packages
    .filter((p) => p.source !== null && linked.has(`${p.name}@${p.version}`))
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license ?? '',
      repository: p.repository ?? '',
      dir: dirname(p.manifest_path),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  const workspace = new Set(
    meta.packages.filter((p) => p.source === null).map((p) => `${p.name}@${p.version}`),
  )
  const missing = [...linked].filter(
    (id) => !workspace.has(id) && !crates.some((c) => `${c.name}@${c.version}` === id),
  )
  if (missing.length > 0) throw new Error(`cargo metadata 里找不到：${missing.join('、')}`)
  return crates
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)/i

/** 发布包根目录里的许可文件名，排序后返回。 */
export function licenseFiles(names: string[]): string[] {
  return names.filter((n) => LICENSE_FILE.test(n)).sort()
}

/** 发布包里没带许可文件时可以回落的标准原文（SPDX 标识 → 仓库内文件）。 */
const FALLBACK_TEXTS: Record<string, string> = {
  'MPL-2.0': fileURLToPath(new URL('licenses/MPL-2.0.txt', import.meta.url)),
}

/** 没带许可文件时，SPDX 表达式只有一个且在回落表里才可回落；返回其标识，否则 null。 */
export function fallbackLicense(spdx: string): string | null {
  const id = spdx.trim()
  return id in FALLBACK_TEXTS ? id : null
}

interface Section {
  crates: string[]
  title: string
  text: string
}

/** 把 crate 与读到的许可原文合并成声明文本：同一份原文只印一次，下面列出使用它的 crate。 */
export function render(
  entries: Array<{ crate: Crate; files: Array<{ name: string; text: string }> }>,
) {
  const sections = new Map<string, Section>()
  const index: string[] = []
  for (const { crate, files } of entries) {
    const label = `${crate.name} ${crate.version}`
    index.push(`- ${label} — ${crate.license}${crate.repository ? ` — ${crate.repository}` : ''}`)
    for (const file of files) {
      const text = `${file.text.replace(/\r\n/g, '\n').trimEnd()}\n`
      const key = createHash('sha256').update(text).digest('hex')
      const section = sections.get(key)
      if (section) section.crates.push(label)
      else sections.set(key, { crates: [label], title: file.name, text })
    }
  }

  const rule = '='.repeat(80)
  const out = [
    'umuo 随附的 Rust 依赖许可声明 / Third-party Rust crate licenses',
    '',
    '以下 crate 编进了 umuo.app 的 Rust 内核（libumuo_ffi，静态链接），均未修改。',
    'The following crates are statically linked into umuo.app, unmodified.',
    'Source code of every crate is available at https://crates.io/crates/<name>/<version>.',
    '',
    '另外，rusqlite 的 bundled 特性编入了 SQLite 源码，SQLite 属于公有领域（public domain）：',
    'https://www.sqlite.org/copyright.html',
    '',
    rule,
    'Crates',
    rule,
    ...index,
    '',
  ]
  for (const section of sections.values()) {
    out.push(rule, `${section.title} — used by:`, ...section.crates.map((c) => `  ${c}`), rule, '')
    out.push(section.text)
  }
  return out.join('\n')
}

function readEntries(crates: Crate[]) {
  return crates.map((crate) => {
    const names = licenseFiles(readdirSync(crate.dir))
    if (names.length > 0) {
      return {
        crate,
        files: names.map((name) => ({ name, text: readFileSync(join(crate.dir, name), 'utf8') })),
      }
    }
    const id = fallbackLicense(crate.license)
    if (!id) {
      throw new Error(
        `${crate.name} ${crate.version} 的发布包里没有许可文件，许可「${crate.license}」也没有可回落的标准原文`,
      )
    }
    return {
      crate,
      files: [
        {
          name: `${id}（标准原文 / standard text）`,
          text: readFileSync(FALLBACK_TEXTS[id], 'utf8'),
        },
      ],
    }
  })
}

if (import.meta.main) {
  const outFile = process.argv[2]
  if (!outFile) throw new Error('用法：bun scripts/third-party-licenses.ts <输出文件>')
  const cwd = fileURLToPath(new URL('..', import.meta.url))
  const run = (args: string[]) => {
    const proc = Bun.spawnSync(['cargo', ...args], { cwd, stderr: 'inherit' })
    if (proc.exitCode !== 0) throw new Error(`cargo ${args[0]} 失败`)
    return proc.stdout.toString()
  }
  const target = ['--target', 'aarch64-apple-darwin']
  const tree = run([
    'tree',
    '--locked',
    '-p',
    'umuo-ffi',
    '-e',
    'normal,no-proc-macro',
    ...target,
    '--prefix',
    'none',
    '--format',
    '{p}',
  ])
  const meta = JSON.parse(
    run([
      'metadata',
      '--format-version',
      '1',
      '--locked',
      '--filter-platform',
      'aarch64-apple-darwin',
    ]),
  ) as CargoMetadata
  const crates = linkedCrates(meta, parseTree(tree))
  writeFileSync(outFile, render(readEntries(crates)))
  console.log(`${crates.length} 个 Rust crate 的许可声明 → ${outFile}`)
}
