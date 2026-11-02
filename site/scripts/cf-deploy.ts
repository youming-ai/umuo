/**
 * 用 cf 部署 Void 的 Vite 构建产物：先 `bun run build`，再
 *   bun scripts/cf-deploy.ts [--dry-run]
 *
 * 其余参数原样交给 `cf deploy --prebuilt`。Worker 没有任何 secret 或变量。
 * 不用 `void deploy`：void@1.2.1 关联已有 Worker 的流程会丢 secret 并被自身校验拦下（见迁移手册）。
 */
import { join } from 'node:path'
import { prepareVerifiedCfBuild } from './check-void-build'

const site = join(import.meta.dirname, '..')
const args = process.argv.slice(2)
const cf = join(site, 'node_modules/cf/bin/cf')

const { prepared, workerName } = await prepareVerifiedCfBuild()

try {
  console.log(`✓ cf 构建输出已核对：${workerName}`)

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
