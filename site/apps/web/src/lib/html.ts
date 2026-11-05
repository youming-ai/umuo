/**
 * 把 `source` 里第一处 `search` 换成 `replacement`，`replacement` 按原文插入。
 *
 * 构建期往 HTML 里注入正文与 head（`vite.config.ts`、`scripts/prerender-web.ts`）都走这里。
 */
export function replaceLiteral(
  source: string,
  search: string | RegExp,
  replacement: string,
): string {
  return source.replace(search, replacement)
}
