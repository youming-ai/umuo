import { describe, expect, test } from 'bun:test'
import {
  type CargoMetadata,
  type Crate,
  fallbackLicense,
  licenseFiles,
  linkedCrates,
  parseTree,
  render,
} from './third-party-licenses'

function pkg(name: string, version: string, source: string | null = 'registry+crates.io') {
  return {
    id: `${name}@${version}`,
    name,
    version,
    license: 'MIT',
    repository: `https://example.com/${name}`,
    source,
    manifest_path: `/registry/${name}-${version}/Cargo.toml`,
  }
}

const meta: CargoMetadata = {
  packages: [
    pkg('umuo-ffi', '0.2.0', null),
    pkg('zeta', '1.0.0'),
    pkg('alpha', '2.0.0'),
    pkg('quinn', '0.11.0'),
  ],
}

function crate(name: string, license = 'MIT'): Crate {
  return { name, version: '1.0.0', license, repository: '', dir: `/registry/${name}` }
}

describe('第三方许可声明', () => {
  test('crate 集合以 cargo tree 为准，不收 metadata 里多出的可选依赖', () => {
    const tree = 'umuo-ffi v0.2.0 (/repo/crates/umuo-ffi)\nzeta v1.0.0\nalpha v2.0.0 (*)\n\n'
    const crates = linkedCrates(meta, parseTree(tree))
    expect(crates.map((c) => c.name)).toEqual(['alpha', 'zeta'])
    expect(crates[0].dir).toBe('/registry/alpha-2.0.0')
  })

  test('cargo tree 里有、metadata 里找不到的 crate 直接报错', () => {
    expect(() => linkedCrates(meta, parseTree('ghost v9.9.9'))).toThrow('ghost@9.9.9')
  })

  test('许可文件大小写不敏感、全部收下并排序', () => {
    expect(
      licenseFiles([
        'src',
        'LICENSE-other-bits',
        'Cargo.toml',
        'license',
        'COPYING',
        'NOTICE.md',
        'UNLICENSE',
      ]),
    ).toEqual(['COPYING', 'LICENSE-other-bits', 'NOTICE.md', 'UNLICENSE', 'license'])
  })

  test('只有单一且收录了标准原文的许可才能回落', () => {
    expect(fallbackLicense('MPL-2.0')).toBe('MPL-2.0')
    expect(fallbackLicense('MIT OR Apache-2.0')).toBeNull()
    expect(fallbackLicense('')).toBeNull()
  })

  test('相同原文只印一次，输出不含本机路径', () => {
    const text = render([
      { crate: crate('b'), files: [{ name: 'LICENSE', text: 'MIT text\r\n' }] },
      { crate: crate('a'), files: [{ name: 'LICENSE-MIT', text: 'MIT text\n\n' }] },
      { crate: crate('c', 'ISC'), files: [{ name: 'LICENSE', text: 'ISC text' }] },
    ])
    expect(text.match(/MIT text/g)).toHaveLength(1)
    expect(text).toContain('LICENSE — used by:\n  b 1.0.0\n  a 1.0.0')
    expect(text).toContain('- c 1.0.0 — ISC')
    expect(text).toContain('SQLite')
    expect(text).not.toContain('/registry/')
  })
})
