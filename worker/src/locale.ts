import type { Env } from './env'

/**
 * 官网不在地址里放语言：访客永远看到 `/`。
 *
 * 构建产物里每种语言有一份预渲染的 `/<locale>/index.html`（内部文件）。访问 `/` 时这里挑一份返回：
 * 先看访客上次选的语言（cookie），再看浏览器语言，最后是简体中文。直接返回对应语言的 HTML，
 * 不会先闪一下别的语言。旧的 `/en/` 这类地址记住语言后 301 回 `/`。
 *
 * 语言清单与 apps/web/src/config.ts 的 LOCALES 保持一致（locale.test.ts 会比对）。
 */
export const LOCALES = ['zh-cn', 'zh-tw', 'en', 'ja', 'ko'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'zh-cn'

/** 与 apps/web/src/lib/router.tsx 的 LOCALE_COOKIE 一致 */
export const LOCALE_COOKIE = 'umuo-lang'

const ONE_YEAR = 60 * 60 * 24 * 365

function isLocale(value: string | undefined): value is Locale {
  return (LOCALES as readonly string[]).includes(value ?? '')
}

function cookieLocale(header: string | null): Locale | null {
  for (const part of (header ?? '').split(';')) {
    const [name, value] = part.trim().split('=')
    if (name === LOCALE_COOKIE && isLocale(value)) return value
  }
  return null
}

/** 浏览器语言标签 → 站点语言；繁体（台湾 / 香港 / 澳门 / Hant）归 zh-tw，其余中文归 zh-cn */
function tagLocale(tag: string): Locale | null {
  const lower = tag.toLowerCase()
  if (lower === 'zh' || lower.startsWith('zh-')) {
    return /^zh-(tw|hk|mo|hant)/.test(lower) ? 'zh-tw' : 'zh-cn'
  }
  const primary = lower.split('-')[0]
  return isLocale(primary) ? primary : null
}

/** 按 q 值从高到低取第一个能对上的语言 */
function acceptLocale(header: string | null): Locale | null {
  const ranked = (header ?? '')
    .split(',')
    .map((entry, index) => {
      const [tag = '', ...params] = entry.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1, index }
    })
    .filter((item) => item.tag && item.tag !== '*' && item.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
  for (const { tag } of ranked) {
    const locale = tagLocale(tag)
    if (locale) return locale
  }
  return null
}

export function pickLocale(request: Request): Locale {
  return (
    cookieLocale(request.headers.get('cookie')) ??
    acceptLocale(request.headers.get('accept-language')) ??
    DEFAULT_LOCALE
  )
}

/** 取某种语言的预渲染页；绑定出错或文件缺失时返回 null */
async function localePage(locale: Locale, request: Request, env: Env): Promise<Response | null> {
  try {
    const asset = await env.ASSETS.fetch(new Request(new URL(`/${locale}/`, request.url)))
    return asset.ok ? asset : null
  } catch {
    return null
  }
}

/** `/`：返回挑中语言的预渲染页面；那份取不到时退回简体中文，再不行才报错 */
export async function handleHome(request: Request, env: Env): Promise<Response> {
  let locale = pickLocale(request)
  let asset = await localePage(locale, request, env)
  if (!asset && locale !== DEFAULT_LOCALE) {
    locale = DEFAULT_LOCALE
    asset = await localePage(locale, request, env)
  }
  if (!asset) {
    return new Response('Service temporarily unavailable', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  const response = new Response(asset.body, asset)
  // 同一个地址按访客返回不同语言：缓存必须按这两个请求头区分，且每次回源确认
  response.headers.set('vary', 'Cookie, Accept-Language')
  response.headers.set('cache-control', 'no-cache')
  response.headers.set('content-language', locale)
  return response
}

/**
 * 首页的别名地址：`/index.html` 301 回 `/`（只留一个首页地址）；
 * `/en/`、`/ja` 这类带语言前缀的旧地址记住语言后 301 回 `/`。查询参数（如 utm）原样保留。
 */
export function localeRedirect(pathname: string, url: string): Response | null {
  const target = new URL(url)
  target.pathname = '/'
  target.hash = ''
  if (pathname === '/index.html') {
    return new Response(null, {
      status: 301,
      headers: { location: target.toString(), 'cache-control': 'no-store' },
    })
  }
  const segment = pathname.split('/').filter(Boolean)[0]
  if (!isLocale(segment)) return null
  return new Response(null, {
    status: 301,
    headers: {
      location: target.toString(),
      'set-cookie': `${LOCALE_COOKIE}=${segment}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`,
      'cache-control': 'no-store',
    },
  })
}
