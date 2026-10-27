import type { SiteContent } from '../content/types'
import { DownloadButton } from './DownloadButton'

/**
 * 定价页：买断 + 自带 Key 本质上是两笔账，排成对照本的左右两页——左页付给 umuo（一次），
 * 右页付给模型供应商（按用量），中间一道装订线。下面是「包含」清单，配默认快捷键。
 *
 * ponytail: 购买入口还没有——买断价格与许可证流程验收前只放下载按钮和一句「尚未开放购买」。
 * 旧的订阅结账表单（月付 / 年付）随订阅一起删了，接一次性购买时按新商品重写，见 git 历史。
 */
export function PricingPage({ content }: { content: SiteContent }) {
  const { pricing } = content
  const macos = content.hero.platforms.find((platform) => platform.id === 'macos')
  const [umuo, provider] = pricing.bills
  return (
    <article className="pricing container-page">
      <h1 className="section-title">{pricing.title}</h1>
      <p className="lead mt-4">{pricing.lead}</p>

      <div className="pricing-spread">
        <section className="pricing-page" aria-labelledby="bill-umuo">
          <h2 id="bill-umuo" className="pricing-payee">
            {umuo.payee}
          </h2>
          <p className="pricing-amount">{umuo.amount}</p>
          <p className="pricing-cadence">{umuo.cadence}</p>
          {macos ? (
            <div className="pricing-action">
              <DownloadButton
                label={macos.actionLabel}
                status={macos.statusLabel}
                className="btn-solid"
              />
              <p className="pricing-fineprint">{pricing.unavailable}</p>
            </div>
          ) : null}
          <p className="pricing-body">{umuo.body}</p>
        </section>
        <section className="pricing-page" aria-labelledby="bill-provider">
          <h2 id="bill-provider" className="pricing-payee">
            {provider.payee}
          </h2>
          <p className="pricing-amount is-quiet">{provider.amount}</p>
          <p className="pricing-cadence">{provider.cadence}</p>
          <p className="pricing-body">{provider.body}</p>
        </section>
      </div>

      <section className="pricing-included" aria-labelledby="included">
        <div>
          <h2 id="included" className="pricing-included-title">
            {pricing.included}
          </h2>
          <p className="pricing-fineprint">{pricing.includedNote}</p>
        </div>
        <ul>
          {pricing.features.map((feature) => (
            <li key={feature.name}>
              <span>{feature.name}</span>
              {feature.keys ? (
                <span className="flex shrink-0 gap-1">
                  {feature.keys.map((key, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 键帽是静态列表，且连按会出现两个相同的键
                    <kbd key={index} className="keycap keycap-sm">
                      {key}
                    </kbd>
                  ))}
                </span>
              ) : feature.tag ? (
                <span className="tag">{feature.tag}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </article>
  )
}
