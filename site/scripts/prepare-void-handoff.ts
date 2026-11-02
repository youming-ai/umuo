/**
 * 在临时目录为现有 Worker 准备一次性 cf 构建：保留旧代码、路由和绑定，仅增加版本元数据。
 * 只构建与 dry-run，不上传或部署。参数必须是当前线上 Worker 对应的已提交 Git 版本。
 *
 *   bun run prepare:handoff <线上提交>
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import production from '../void.config'

const ref = process.argv[2]
if (!ref || ref.startsWith('-')) throw new Error('请提供当前线上 Worker 对应的 Git 提交')
const site = resolve(import.meta.dirname, '..')
const repo = resolve(site, '..')
const scratch = mkdtempSync(join(tmpdir(), 'umuo-void-handoff-'))
const project = join(scratch, 'site')
const cf = join(site, 'node_modules/cf/bin/cf')
const safeEnv = { ...process.env }
for (const key of [
  'CLOUDFLARE_API_TOKEN',
  'CF_API_TOKEN',
  'CLOUDFLARE_API_KEY',
  'CF_API_KEY',
  'VOID_TOKEN',
  'SPARKLE_PRIVATE_KEY',
  'TAURI_SIGNING_PRIVATE_KEY',
])
  delete safeEnv[key]

function run(command: string[], cwd: string, allowMigrationNotice = false): string {
  const result = Bun.spawnSync({ cmd: command, cwd, env: safeEnv, stdout: 'pipe', stderr: 'pipe' })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (
    result.exitCode !== 0 &&
    !(allowMigrationNotice && output.includes('Migration requires follow-up work'))
  ) {
    throw new Error(`${command[0]} 执行失败：\n${output}`)
  }
  return output
}

try {
  const commit = run(['git', 'rev-parse', '--verify', `${ref}^{commit}`], repo).trim()
  const archive = join(scratch, 'site.tar')
  run(['git', 'archive', '--format=tar', `--output=${archive}`, commit, 'site'], repo)
  run(['tar', '-xf', archive, '-C', scratch], repo)
  const legacy = readFileSync(join(project, 'wrangler.jsonc'), 'utf8')
  const oldRoutes = legacy.match(/"run_worker_first":\s*\[([\s\S]*?)\]/)?.[1]
  if (!oldRoutes) throw new Error('旧配置缺少静态资源路由，无法验证接管基线')
  const oldWorkerFirst = JSON.parse(`[${oldRoutes}]`)
  // 用旧提交自己的锁文件重建依赖，避免把当前工作区升级后的工具混进旧版构建。
  run(['bun', 'install', '--frozen-lockfile'], project)
  run(['bun', 'run', 'build:web'], project)

  // 旧 Worker 的一次性构建沿用原 Wrangler bundler；避免 cf 将网站 Vite 配置误认成构建入口。
  const packagePath = join(project, 'package.json')
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  delete manifest.workspaces
  if (typeof manifest.devDependencies?.wrangler !== 'string') {
    throw new Error('旧提交缺少 Wrangler bundler，无法复现线上构建')
  }
  manifest.devDependencies = { cf: '1.0.0-beta.18', wrangler: manifest.devDependencies.wrangler }
  writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)
  run(['node', cf, 'migrate', '--no-install', '--bundler', 'wrangler', '--force'], project, true)

  // cf migrate 对已禁用的预览和 --no-install 留下人工检查提示；下面独立校验全部正式字段。
  const generated = join(project, 'cloudflare.config.ts')
  let configText = readFileSync(generated, 'utf8')
  const blocker =
    'throw new Error("Migration incomplete. Resolve every cf migrate TODO in `cloudflare.config.ts`.");'
  const assets = 'ASSETS: bindings.assets(),'
  if (!configText.includes(blocker) || !configText.includes(assets)) {
    throw new Error('cf 迁移输出与预期不同，需人工核对')
  }
  configText = configText
    .replace(blocker, '')
    .replaceAll(assets, `${assets}\n\t\t\t\tVERSION_METADATA: bindings.versionMetadata(),`)
  writeFileSync(generated, configText)
  run(['node', cf, 'build'], project)

  const built = JSON.parse(
    readFileSync(join(project, '.cloudflare/output/v0/workers/default/worker.config.json'), 'utf8'),
  )
  const expected = production.cloudflare as Record<string, unknown>
  const kv = expected.kv_namespaces as { binding: string; id: string }[]
  const buckets = expected.r2_buckets as { binding: string; bucket_name: string }[]
  const vars = (production.worker as { vars?: Record<string, string> } | undefined)?.vars ?? {}
  const domains = (expected.routes as { pattern: string }[]).map((route) => route.pattern)
  const expectedBindings = [
    ...Object.keys(vars),
    ...kv.map(({ binding }) => binding),
    ...buckets.map(({ binding }) => binding),
    'ASSETS',
    'VERSION_METADATA',
  ].sort()
  const observability = expected.observability as {
    enabled: boolean
    logs: { enabled: boolean; persist: boolean; invocation_logs: boolean }
    traces: { enabled: boolean }
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  if (
    built.name !== expected.name ||
    built.compatibilityDate !== production.worker?.compatibility_date ||
    !same(built.compatibilityFlags, production.worker?.compatibility_flags) ||
    built.workersDev !== expected.workers_dev ||
    built.previewUrls !== expected.preview_urls ||
    !same(built.domains, domains) ||
    !same(built.assets?.runWorkerFirst, oldWorkerFirst) ||
    !same(Object.keys(built.env ?? {}).sort(), expectedBindings) ||
    built.observability?.enabled !== observability.enabled ||
    built.observability?.logs?.enabled !== observability.logs.enabled ||
    built.observability?.logs?.persist !== observability.logs.persist ||
    built.observability?.logs?.invocationLogs !== observability.logs.invocation_logs ||
    built.observability?.traces?.enabled !== observability.traces.enabled ||
    built.env?.ASSETS?.type !== 'assets' ||
    built.env?.VERSION_METADATA?.type !== 'version-metadata' ||
    kv.some(
      ({ binding, id }) => built.env?.[binding]?.type !== 'kv' || built.env?.[binding]?.id !== id,
    ) ||
    buckets.some(
      ({ binding, bucket_name }) =>
        built.env?.[binding]?.type !== 'r2' || built.env?.[binding]?.name !== bucket_name,
    ) ||
    Object.entries(vars).some(
      ([name, value]) => built.env?.[name]?.type !== 'text' || built.env?.[name]?.value !== value,
    )
  )
    throw new Error('接管构建与正式配置不一致，未生成可用产物')

  const dry = run(['node', cf, 'deploy', '--prebuilt', '--dry-run'], project)
  if (!dry.includes('VERSION_METADATA') || !dry.includes('--dry-run: exiting now.')) {
    throw new Error('cf dry-run 未确认版本元数据绑定')
  }
  console.log(`接管构建已验证：${project}`)
  console.log(`来源提交：${commit}`)
  console.log('未上传、未部署；执行前仍须核对当前活动版本及其 secret。')
} catch (error) {
  rmSync(scratch, { recursive: true, force: true })
  throw error
}
