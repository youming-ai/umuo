import { PURCHASE_OPEN } from '../config'
import type { SiteContent } from '../content/types'
import { DownloadPanel } from './DownloadButton'
import { PurchaseButton } from './PurchaseButton'

/**
 * 定价页：买断 + 自带 Key 本质上是两笔账，排成对照本的左右两页——左页付给 umuo（一次），
 * 右页付给模型供应商（按用量），中间一道装订线。只有左页是 umuo 收的钱，所以只有它用大字；
 * 右页同一位置退成小号灰墨。下面是「包含」清单配默认快捷键，左栏补一份「不包含」。
 *
 * 购买入口由 config.ts 的 `PURCHASE_OPEN` 控制：关闭时只放下载按钮和一句「尚未开放购买」；
 * 打开后下载按钮旁多一个「购买 US$9」，下面一句说明付款后怎么领取、激活许可证。
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
              {/* 「现在免费试用」是好消息：写在按钮上方当正文，不当脚注 */}
              <p className="pricing-free">
                {PURCHASE_OPEN ? pricing.purchase.lead : pricing.unavailable}
              </p>
              <DownloadPanel
                platform={macos}
                purchase={
                  PURCHASE_OPEN ? (
                    <PurchaseButton purchase={pricing.purchase} locale={content.locale} />
                  ) : undefined
                }
              />
              {PURCHASE_OPEN ? (
                <p className="pricing-fineprint purchase-activation">
                  {pricing.purchase.activation}
                </p>
              ) : null}
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
          {/* 「不包含」讲的都是钱和请求不经过 umuo，放在付给供应商这一页的下半，摊开的两页也就平衡了 */}
          <div className="pricing-excluded-block">
            <h3 className="pricing-excluded-title">{pricing.excluded.title}</h3>
            <ul className="pricing-excluded">
              {pricing.excluded.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <section className="pricing-included" aria-labelledby="included">
        <div>
          <h2 id="included" className="pricing-included-title">
            {pricing.included}
          </h2>
          <p className="pricing-fineprint">{pricing.includedNote}</p>
        </div>
        <ul className="pricing-features">
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
