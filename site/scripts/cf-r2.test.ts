import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const tmp = mkdtempSync(join(tmpdir(), 'umuo-cf-r2-'))
const manifest = join(tmp, 'latest.json')
const payload = '{"version":"0.2.0"}\n'
writeFileSync(manifest, payload)
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** 真实 cf 命令使用独立的本地 R2 存储；不访问远端。 */
function runR2(command: string): string {
  const result = spawnSync('sh', ['-c', `. ./scripts/cf-r2.sh; ${command}`], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, UMUO_R2_TEST_FILE: manifest, UMUO_R2_TEST_STATE: join(tmp, 'state') },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`cf 退出码：${result.status}`)
  return result.stdout
}

describe('发布脚本的 cf R2 命令', () => {
  it('上传并按原样读取清单', () => {
    runR2(
      'r2 put macos/latest.json --bucket-name umuo-release-test --file "$UMUO_R2_TEST_FILE" --content-type application/json --local --persist-to "$UMUO_R2_TEST_STATE"',
    )
    const result = runR2(
      'r2 get macos/latest.json --bucket-name umuo-release-test --text --local --persist-to "$UMUO_R2_TEST_STATE"',
    )
    expect(result).toBe(payload)
    expect(
      runR2(
        'r2_current_version macos/latest.json umuo-release-test --local --persist-to "$UMUO_R2_TEST_STATE"',
      ),
    ).toBe('0.2.0\n')
  }, 20_000)

  it('清单不存在时允许首次发布，其他错误必须中止', () => {
    expect(
      runR2(
        'r2_current_version macos/missing.json umuo-release-test --local --persist-to "$UMUO_R2_TEST_STATE"',
      ),
    ).toBe('')
    expect(() =>
      runR2(
        'r2_current_version macos/latest.json umuo-release-test --no-such-option --local --persist-to "$UMUO_R2_TEST_STATE"',
      ),
    ).toThrow()
  }, 20_000)

  it('损坏的清单不会绕过版本检查', () => {
    writeFileSync(manifest, '{"version":"invalid"}')
    runR2(
      'r2 put macos/bad.json --bucket-name umuo-release-test --file "$UMUO_R2_TEST_FILE" --content-type application/json --local --persist-to "$UMUO_R2_TEST_STATE"',
    )
    expect(() =>
      runR2(
        'r2_current_version macos/bad.json umuo-release-test --local --persist-to "$UMUO_R2_TEST_STATE"',
      ),
    ).toThrow()
  }, 20_000)
})
