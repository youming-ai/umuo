import type { PricingContent } from '../content/types'

/** 定价页：三个方案并排（手机上竖排），下面是购买、试用、税费、取消与退款说明。没有结账按钮——订阅在应用内购买。 */
export function PricingPage({ pricing }: { pricing: PricingContent }) {
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
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <dl className="pricing-notes">
        {pricing.notes.map((note) => (
          <div key={note.heading}>
            <dt>{note.heading}</dt>
            <dd>{note.body}</dd>
          </div>
        ))}
      </dl>
    </article>
  )
}
