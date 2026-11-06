import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(
  new URL('../.github/scripts/import-signing-identity.sh', import.meta.url),
)

// 所有签名命令都替换成假实现，不读真实私钥、不碰 Keychain 或证书信任。
function runImport(options: { trusted?: boolean; denySudo?: boolean; local?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'umuo-signing-test-'))
  const bin = join(dir, 'bin')
  const runner = join(dir, 'runner')
  const envFile = join(dir, 'github-env')
  const callsFile = join(dir, 'calls')
  mkdirSync(bin)
  mkdirSync(runner)
  writeFileSync(envFile, '')
  writeFileSync(callsFile, '')
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
      },
      timeout: 5000,
    })
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      calls: readFileSync(callsFile, 'utf8'),
      exported: readFileSync(envFile, 'utf8'),
      leftovers: readdirSync(runner),
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
