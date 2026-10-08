/**
 * Worker 的绑定。
 *
 * 这里手写而不跑 `wrangler types` 生成：生成物要么提交（会与 wrangler.toml 漂移），
 * 要么每次构建前重跑（构建多一步、失败多一种）。我们只用到 KV 的两个方法，
 * 手写反而更不容易出错。
 *
 * `NotifyStore` 是 KV 的**最小可用子集**，而不是 `KVNamespace` 本身 ——
 * 真实的 `KVNamespace` 结构上满足它，测试里也就能用一个几十行的假实现替身，
 * 不需要为了类型检查去伪造整个 KV API。
 */
export interface NotifyStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

/** R2 的最小可用子集：只读、按 key 取对象。真实的 `R2Bucket` 结构上满足它。 */
export interface ReleaseObject {
  body: ReadableStream | null
  size: number
  text(): Promise<string>
}

export interface ReleaseStore {
  get(key: string): Promise<ReleaseObject | null>
}

export interface Env {
  /** 上线通知的邮箱列表（KV namespace: umuo-notify，见 docs/DEPLOY.md） */
  NOTIFY_KV: NotifyStore
  /** 客户端安装包（R2 桶 umuo-releases，由私有仓库的 Release 工作流写入，见 docs/DEPLOY.md） */
  RELEASES: ReleaseStore
}
