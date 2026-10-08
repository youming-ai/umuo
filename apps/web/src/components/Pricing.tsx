import { useState } from 'react'
import type { Billing, SiteContent } from '../content/types'
import { CheckIcon } from './icons'
import { NotifyForm } from './NotifyForm'
import { Section } from './Section'

/**
 * 定价三栏（Free 账号 / Pro / Pro + 高级 AI）。
 * 默认展示年付（PRD §10.4：低价月付会被支付固定手续费吃掉一成）。
 * 结账流程依赖尚未实现的服务端，所以 CTA 现在打开的是「订阅上线通知」，
 * 并把方案名写进邮件主题，不假装能立即付款。
 */
export function Pricing({ content }: { content: SiteContent }) {
  const { pricing } = content
  const [billing, setBilling] = useState<Billing>('yearly')
  const [notifyPlan, setNotifyPlan] = useState<string | null>(null)

  return (
    <Section
      id="pricing"
      headingLevel="h1"
      title={pricing.title}
      description={pricing.description}
      className="pricing-section"
    >
      <div className="billing-switch flex flex-wrap items-center gap-3">
        <fieldset className="m-0 inline-flex items-center gap-1 border border-border p-1">
          <legend className="sr-only">{pricing.billingLabel}</legend>
          {(['monthly', 'yearly'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={billing === option}
              onClick={() => setBilling(option)}
              className={[
                'px-4 py-2 text-sm font-medium transition-colors',
                billing === option ? '' : 'text-text-secondary hover:text-text-primary',
              ].join(' ')}
            >
              {option === 'monthly' ? pricing.monthly : pricing.yearly}
            </button>
          ))}
        </fieldset>
        <span className="u-accent-border u-accent-text rounded-full border bg-background-tertiary px-3 py-1 text-xs">
          {pricing.yearlyBadge}
        </span>
      </div>

      <ul className="pricing-grid mx-auto mt-10 grid max-w-6xl items-stretch lg:grid-cols-3">
        {pricing.tiers.map((tier) => (
          <li
            key={tier.id}
            className={[
              'pricing-card relative flex h-full flex-col',
              tier.highlight ? 'pricing-featured' : '',
            ].join(' ')}
          >
            <div className="flex min-h-8 items-center justify-between gap-3">
              <h3 className="font-heading text-xl font-semibold text-text-primary">{tier.name}</h3>
              {tier.highlight ? (
                <span className="pricing-badge px-3 py-1 text-xs font-medium">
                  {pricing.recommended}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-text-tertiary">{tier.tagline}</p>

            <p className="mt-6 flex items-baseline gap-2">
              <span className="font-heading text-5xl font-semibold text-text-primary">
                {billing === 'monthly' ? tier.priceMonthly : tier.priceYearly}
              </span>
              <span className="text-sm text-text-tertiary">
                {billing === 'monthly' ? tier.periodMonthly : tier.periodYearly}
              </span>
            </p>
            <p className="mt-2 text-xs text-text-tertiary">{tier.requirement}</p>

            <div className="my-6">
              <button
                type="button"
                onClick={() =>
                  setNotifyPlan(
                    `${tier.name} · ${billing === 'monthly' ? pricing.monthly : pricing.yearly}`,
                  )
                }
                aria-expanded={
                  notifyPlan ===
                  `${tier.name} · ${billing === 'monthly' ? pricing.monthly : pricing.yearly}`
                }
                className={tier.highlight ? 'btn-primary w-full' : 'btn-secondary w-full'}
              >
                {tier.cta}
              </button>
            </div>
            <ul className="flex flex-1 flex-col gap-4 border-border-muted border-t pt-6">
              {tier.features.map((feature) => (
                <li
                  key={feature}
                  className="flex gap-3 text-sm leading-relaxed text-text-secondary"
                >
                  <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 u-accent-text" />
                  {feature}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {notifyPlan ? (
        <NotifyForm
          content={content.hero.notify}
          platformName={notifyPlan}
          onClose={() => setNotifyPlan(null)}
        />
      ) : null}

      <p className="mt-10 text-text-secondary">
        <span className="font-medium text-text-primary">{pricing.openSource.title}</span>{' '}
        {pricing.openSource.description}
      </p>
    </Section>
  )
}
