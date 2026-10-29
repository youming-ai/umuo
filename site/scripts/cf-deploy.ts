/**
 * 用 cf 部署 Void 的 Vite 构建产物：先 `bun run build`，再
 *   bun scripts/cf-deploy.ts [--dry-run] [--secrets-file <path>]
 *
 * 不用 `void deploy`：void@1.2.1 关联已有 Worker 的流程会丢 secret 并被自身校验拦下（见迁移手册）。
 * cf 上传的版本从「最新上传」继承 secret；最新上传缺 secret 时，必须用 --secrets-file 显式带上。
 */
import { join } from 'node:path'
import { prepareVerifiedCfBuild } from './check-void-build'

const site = join(import.meta.dirname, '..')
const args = process.argv.slice(2)
const cf = join(site, 'node_modules/cf/bin/cf')

const { prepared, workerName } = await prepareVerifiedCfBuild()

try {
  console.log(`✓ cf 构建输出已核对：${workerName}（${'正式'}）`)

  const result = Bun.spawnSync({
    cmd: ['node', cf, 'deploy', '--prebuilt', ...args],
    cwd: prepared.directory,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  process.exitCode = result.exitCode ?? 1
} finally {
  await prepared.dispose()
}
