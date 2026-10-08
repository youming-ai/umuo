/**
 * 这一层只有一件事：让响应永远是 JSON，且默认不进任何缓存。
 *
 * 每个 `json()` 都是新构造的 Response，所以调用方可以自由改状态码，
 * 不会共享到别人的 header（曾经踩过：把 Response 提到模块级复用，
 * 结果一处改了 header 全站跟着变）。
 */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 上线通知的响应是「这一次提交」的结果，没有任何可复用性；
      // 中间层缓存住它会让我们把限流与重复提交都判错。
      'cache-control': 'no-store',
      ...headers,
    },
  })
}
