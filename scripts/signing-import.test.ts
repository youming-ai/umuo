import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(
  new URL('../.github/scripts/import-signing-identity.sh', import.meta.url),
)

// 所有签名命令都替换成假实现，不读真实私钥、不碰 Keychain 或证书信任。
function runImport(
  options: { trusted?: boolean; denySudo?: boolean; local?: boolean; denySign?: boolean } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'umuo-signing-test-'))
  const bin = join(dir, 'bin')
  const runner = join(dir, 'runner')
  const envFile = join(dir, 'github-env')
  const callsFile = join(dir, 'calls')
  const searchList = join(dir, 'search-list')
  const existingKeychain = join(dir, 'existing keychain-db')
  mkdirSync(bin)
  mkdirSync(runner)
  writeFileSync(envFile, '')
  writeFileSync(callsFile, '')
  writeFileSync(searchList, `${existingKeychain}\n`)
  writeFileSync(
    join(bin, 'openssl'),
    '#!/bin/sh\ncase "$1" in rand) echo fake-password ;; x509) echo SHA1=AA:BB:CC ;; esac\n',
    { mode: 0o700 },
  )
  writeFileSync(
    join(bin, 'security'),
    `#!/bin/sh
echo "$1" >> "$SIGNING_TEST_CALLS"
case "$1" in
  list-keychains)
    if [ "$4" = -s ]; then
      shift 4
      printf '%s\\n' "$@" > "$SIGNING_TEST_SEARCH_LIST"
    else
      while IFS= read -r entry; do printf '    "%s"\\n' "$entry"; done < "$SIGNING_TEST_SEARCH_LIST"
    fi ;;
  verify-cert) [ "$SIGNING_TEST_TRUSTED" = 1 ] ;;
  add-trusted-cert)
    # 不允许回到需要用户确认的信任修改路径。
    [ "$SIGNING_TEST_ELEVATED" = 1 ] && [ "$2" = -d ] ;;
  find-identity) echo '1) AABBCC "umuo Self-Signed"' ;;
esac
`,
    { mode: 0o700 },
  )
  writeFileSync(
    join(bin, 'codesign'),
    `#!/bin/sh
echo "codesign $1" >> "$SIGNING_TEST_CALLS"
[ "$SIGNING_TEST_DENY_SIGN" != 1 ] || exit 12
# 模拟 codesign 的证书链查找：显式 --keychain 不能替代用户搜索列表。
grep -Fxq "$RUNNER_TEMP/umuo-signing.keychain-db" "$SIGNING_TEST_SEARCH_LIST"
`,
    { mode: 0o700 },
  )
  writeFileSync(
    join(bin, 'sudo'),
    `#!/bin/sh
echo "sudo $*" >> "$SIGNING_TEST_CALLS"
[ "$1" = -n ] || exit 10
[ "$SIGNING_TEST_DENY_SUDO" != 1 ] || exit 11
shift
SIGNING_TEST_ELEVATED=1 exec "$@"
`,
    { mode: 0o700 },
  )
  try {
    const result = Bun.spawnSync(['sh', script], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_ACTIONS: options.local ? 'false' : 'true',
        RUNNER_TEMP: runner,
        GITHUB_ENV: envFile,
        UMUO_SIGNING_P12_BASE64: Buffer.from('fake-p12').toString('base64'),
        UMUO_SIGNING_P12_PASSWORD: 'fake-p12-password',
        SIGNING_TEST_CALLS: callsFile,
        SIGNING_TEST_TRUSTED: options.trusted ? '1' : '0',
        SIGNING_TEST_DENY_SUDO: options.denySudo ? '1' : '0',
        SIGNING_TEST_DENY_SIGN: options.denySign ? '1' : '0',
        SIGNING_TEST_SEARCH_LIST: searchList,
      },
      timeout: 5000,
    })
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      calls: readFileSync(callsFile, 'utf8'),
      exported: readFileSync(envFile, 'utf8'),
      leftovers: readdirSync(runner),
      searchList: readFileSync(searchList, 'utf8'),
      existingKeychain,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('未信任时非交互授权管理员域代码签名信任，核验身份后才导出钥匙串', () => {
  const result = runImport()
  expect(result.exitCode).toBe(0)
  expect(result.calls).toContain(
    'sudo -n security add-trusted-cert -d -r trustRoot -p codeSign -k ',
  )
  expect(result.calls).toContain('find-identity')
  expect(result.exported).toContain('APPLE_SIGNING_KEYCHAIN=')
  expect(result.leftovers).toEqual([])
  expect(result.stdout).not.toContain('fake-p12-password')
  expect(result.stdout).not.toContain(Buffer.from('fake-p12').toString('base64'))
})

test('非交互授权失败就停止，不导出签名配置且删除临时 p12', () => {
  const result = runImport({ denySudo: true })
  expect(result.exitCode).not.toBe(0)
  expect(result.calls).not.toContain('find-identity')
  expect(result.exported).toBe('')
  expect(result.leftovers).toEqual([])
})

test('已信任的证书无需再次提权', () => {
  const result = runImport({ trusted: true })
  expect(result.exitCode).toBe(0)
  expect(result.calls).not.toContain('sudo')
  expect(result.calls).not.toContain('add-trusted-cert')
})

test('拒绝在本机执行 runner 管理员域授权', () => {
  const result = runImport({ local: true })
  expect(result.exitCode).not.toBe(0)
  expect(result.calls).toBe('')
  expect(result.exported).toBe('')
})

test('试签前将临时钥匙串加入搜索列表，并保留含空格的原有路径', () => {
  const result = runImport()
  expect(result.exitCode).toBe(0)
  expect(result.searchList).toContain('/umuo-signing.keychain-db\n')
  expect(result.searchList).toContain(`${result.existingKeychain}\n`)
  expect(result.calls).toContain('codesign --force')
  expect(result.calls).toContain('codesign --verify')
})

test('身份能查到但实际试签失败时，不导出配置并清理临时文件', () => {
  const result = runImport({ denySign: true })
  expect(result.exitCode).not.toBe(0)
  expect(result.exported).toBe('')
  expect(result.leftovers).toEqual([])
})
