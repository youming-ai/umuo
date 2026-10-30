import { useState } from 'react'
import type { Locale, PurchaseContent } from '../content/types'

/**
 * 「购买 US$9」：向 Worker 要一个 Waffo 收银台链接（`POST /api/checkout`），拿到就跳过去；
 * 付完款 Waffo 会跳回 `/activate?claim=…` 领取许可证。
 *
 * 不收邮箱：收银台自己会问，官网少一个表单，首页也就还是一屏。
 * 只由 `PURCHASE_OPEN` 打开（见 config.ts）；渲染期不读 window，请求只在点击时发。
 */
export function PurchaseButton({
  purchase,
  locale,
}: {
  purchase: PurchaseContent
  locale: Locale
}) {
  const [state, setState] = useState<'idle' | 'opening' | 'unavailable' | 'error'>('idle')

  async function buy() {
    setState('opening')
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale }),
      })
      // 503：Worker 还没配好买断商品；429：点得太快。两种都是「稍后再试」，但前者不是访客的问题
      if (response.status === 503) return setState('unavailable')
      const body = response.ok ? ((await response.json()) as { url?: unknown }) : null
      if (typeof body?.url !== 'string') return setState('error')
      window.location.assign(body.url)
    } catch {
      setState('error')
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={state === 'opening'}
        onClick={() => void buy()}
      >
        {state === 'opening' ? purchase.opening : purchase.buy}
      </button>
      {state === 'unavailable' || state === 'error' ? (
        <p className="download-note purchase-error" role="status">
          {state === 'unavailable' ? purchase.unavailable : purchase.error}
        </p>
      ) : null}
    </>
  )
}
