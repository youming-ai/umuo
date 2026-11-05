/**
 * 把 `source` 里第一处 `search` 换成 `replacement`，`replacement` 按原文插入。
 *
 * 构建期往 HTML 里注入正文与 head（`vite.config.ts`、`scripts/prerender-web.ts`）都走这里。
 * 用函数替换器：字符串形式的第二个参数会把 `$&`、`` $` ``、`$'`、`$$` 当成替换模式展开，
 * 正文或 head 里一旦出现这些字符就会被悄悄改掉。
 */
export function replaceLiteral(
  source: string,
  search: string | RegExp,
  replacement: string,
): string {
  return source.replace(search, () => replacement)
}
