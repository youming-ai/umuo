/**
 * Worker 的绑定。
 *
 * 这里手写而不提交生成类型：生成物要么提交（会与 void.config.ts 漂移），
 * 要么每次构建前重跑（构建多一步、失败多一种）。现在只剩静态资源一个绑定，手写更不容易出错。
 * 上线通知（KV）与安装包（R2）都已下线：安装包在 GitHub Releases，Worker 只做跳转（见 releases.ts）。
 */

/** 静态资源绑定的最小可用子集：Worker 用它取各语言的预渲染页面 */
export interface AssetFetcher {
  fetch(request: Request): Promise<Response>
}

export interface Env {
  /** 官网静态产物（Void 生成的 assets.binding） */
  ASSETS: AssetFetcher
}
