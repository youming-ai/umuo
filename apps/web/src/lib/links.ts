import { CONTACT_EMAIL } from '../config'
import type { FooterLinkKind, NavLinkKind } from '../content/types'

/**
 * 链接目标的唯一出处：内容模型只存文案，URL 都在这里。
 * 站内锚点返回 `hash`，站外链接返回 `href`。
 */

export type LinkTarget =
  | { kind: 'hash'; hash: string }
  | { kind: 'external'; href: string }
  | { kind: 'soon' }

/** 导航只有站内锚点 */
export type NavTarget = { kind: 'hash'; hash: string }

const NAV_TARGETS: Record<NavLinkKind, NavTarget> = {
  product: { kind: 'hash', hash: 'top' },
  features: { kind: 'hash', hash: 'download' },
  pricing: { kind: 'hash', hash: 'pricing' },
  comparison: { kind: 'hash', hash: 'comparison' },
  faq: { kind: 'hash', hash: 'faq' },
}

const FOOTER_TARGETS: Record<FooterLinkKind, LinkTarget> = {
  ...NAV_TARGETS,
  contact: { kind: 'external', href: `mailto:${CONTACT_EMAIL}` },
  top: { kind: 'hash', hash: 'top' },
  // 法务页面尚未撰写，页脚按「即将上线」展示而不是留死链
  privacy: { kind: 'soon' },
  terms: { kind: 'soon' },
}

export function navTarget(kind: NavLinkKind): NavTarget {
  return NAV_TARGETS[kind]
}

export function footerTarget(kind: FooterLinkKind): LinkTarget {
  return FOOTER_TARGETS[kind]
}
