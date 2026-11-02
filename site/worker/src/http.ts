/**
 * 这一层只有一件事：让响应永远是 JSON，且默认不进任何缓存。
 *
 * 每个 `json()` 都是新构造的 Response，所以调用方（以及 dispatch 末尾补安全头）可以自由改它，
 * 不会共享到别人的 header（曾经踩过：把 Response 提到模块级复用，
 * 结果一处改了 header 全站跟着变）。
 */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 接口响应（健康检查与各种 404）都很小，缓存它们没有收益，只会让修好的问题继续被看到。
      'cache-control': 'no-store',
    },
  })
}
