import { type FormEvent, useId, useState } from 'react'
import { CHECKOUT_ENABLED } from '../config'
import type { CheckoutContent, PricingPlan, SiteContent } from '../content/types'
import { DownloadButton } from './DownloadButton'

/**
 * 定价页：方案并排（手机上竖排），下面是购买、税费、取消与退款说明。
 * 免费方案放下载按钮；付费方案放结账表单（`CHECKOUT_ENABLED` 关着时只放一句说明，
 * 依赖结账的那几条说明也不显示——写了却做不到的步骤比不写更糟）。
 */
export function PricingPage({ content }: { content: SiteContent }) {
  const { pricing } = content
  const macos = content.hero.platforms.find((platform) => platform.id === 'macos')
  const notes = pricing.notes.filter((note) => CHECKOUT_ENABLED || !note.checkoutOnly)
  return (
    <article className="pricing container-page">
      <h1 className="section-title">{pricing.title}</h1>
      <p className="lead mt-4">{pricing.lead}</p>
      <ul className="pricing-plans">
        {pricing.plans.map((plan) => (
          <li key={plan.name}>
            <h2>{plan.name}</h2>
            <p className="pricing-tagline">{plan.tagline}</p>
            <p className="pricing-price">{plan.monthly}</p>
            <p className="pricing-yearly">{plan.yearly}</p>
            <PlanAction plan={plan} checkout={pricing.checkout} download={macos} />
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <dl className="pricing-notes">
        {notes.map((note) => (
          <div key={note.heading}>
            <dt>{note.heading}</dt>
            <dd>{note.body}</dd>
          </div>
        ))}
      </dl>
    </article>
  )
}

function PlanAction({
  plan,
  checkout,
  download,
}: {
  plan: PricingPlan
  checkout: CheckoutContent
  download?: { actionLabel: string; statusLabel: string }
}) {
  if (plan.action === 'download') {
    return download ? (
      <div className="pricing-action">
        <DownloadButton label={download.actionLabel} status={download.statusLabel} />
      </div>
    ) : null
  }
  if (!CHECKOUT_ENABLED) {
    return <p className="pricing-action pricing-fineprint">{checkout.unavailable}</p>
  }
  return <CheckoutForm checkout={checkout} />
}

type BillingPlan = 'premium-monthly' | 'premium-yearly'
type CheckoutState =
  | { kind: 'idle' }
  | { kind: 'opening' }
  /** 收银台已在新标签页打开；留一个链接，访客没看到那个标签页时可以再开一次 */
  | { kind: 'opened'; url: string }
  /** 空白页被浏览器拦了，或访客在等待时把它关了：让访客自己点 */
  | { kind: 'blocked'; url: string }
  | { kind: 'error'; message: string }

/**
 * 结账表单。Waffo 要求收银台在新标签页打开，而 `window.open` 必须发生在点击的同一拍里，
 * 等 fetch 回来再开会被浏览器当成弹窗拦掉——所以先同步开一个空白页，拿到地址再把它导过去；
 * 空白页被拦了、或在等待期间被关掉，就退回一个让访客自己点的链接。
 */
export function CheckoutForm({ checkout }: { checkout: CheckoutContent }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<CheckoutState>({ kind: 'idle' })
  const statusId = useId()

  async function start(event: FormEvent<HTMLFormElement>, plan: BillingPlan) {
    event.preventDefault()
    const tab = window.open('', '_blank')
    setState({ kind: 'opening' })
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, email }),
      })
      const body = (await response.json()) as { ok?: boolean; checkoutUrl?: string; error?: string }
      if (!response.ok || !body.checkoutUrl) throw new Error(body.error ?? 'failed')
      if (!tab || tab.closed) {
        setState({ kind: 'blocked', url: body.checkoutUrl })
        return
      }
      // 收银台不需要回头操作我们的页面：断开 opener，避免它反过来改写这个标签页
      tab.opener = null
      tab.location.href = body.checkoutUrl
      setState({ kind: 'opened', url: body.checkoutUrl })
    } catch (error) {
      tab?.close()
      const code = error instanceof Error ? error.message : ''
      const message =
        code === 'invalid_email'
          ? checkout.errors.invalidEmail
          : code === 'rate_limited'
            ? checkout.errors.rateLimited
            : checkout.errors.failed
      setState({ kind: 'error', message })
    }
  }

  // 两个按钮共用一个表单：按下哪个，submitter 就是哪个（在邮箱框里按回车时是第一个，即月付）
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    void start(event, submitter?.value === 'premium-yearly' ? 'premium-yearly' : 'premium-monthly')
  }

  const busy = state.kind === 'opening'
  const invalid = state.kind === 'error'
  return (
    <form className="pricing-action checkout-form" onSubmit={onSubmit}>
      <label className="checkout-field">
        <span>{checkout.emailLabel}</span>
        <input
          type="email"
          required
          autoComplete="email"
          placeholder={checkout.emailPlaceholder}
          value={email}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? statusId : undefined}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <div className="checkout-buttons">
        <button
          type="submit"
          name="plan"
          value="premium-monthly"
          className="btn-secondary"
          disabled={busy}
        >
          {checkout.monthly}
        </button>
        <button
          type="submit"
          name="plan"
          value="premium-yearly"
          className="btn-primary"
          disabled={busy}
        >
          {checkout.yearly}
        </button>
      </div>
      {/* 状态单独一行、唯一的 live region；付款与试用说明始终留在下面 */}
      <p id={statusId} className="checkout-status" aria-live="polite">
        {state.kind === 'opening' ? (
          checkout.opening
        ) : state.kind === 'opened' || state.kind === 'blocked' ? (
          <a href={state.url} target="_blank" rel="noopener noreferrer">
            {state.kind === 'opened' ? checkout.opened : checkout.openManually}
          </a>
        ) : state.kind === 'error' ? (
          state.message
        ) : null}
      </p>
      <p className="pricing-fineprint">{checkout.fineprint}</p>
    </form>
  )
}
