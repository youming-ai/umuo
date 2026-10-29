import {
  CONTACT_EMAIL,
  LEGAL_COUNTRY,
  LEGAL_EFFECTIVE,
  LEGAL_NAME,
  LEGAL_VERSION,
  SITE_URL,
} from '../config'
import type { SiteContent } from './types'

/**
 * English copy. Structure follows zh-cn.ts; facts come from docs/PRD.md (v0.5: text,
 * screenshot and voice; one-time purchase, BYOK only). Wording is written for English readers, not translated.
 */
export const en: SiteContent = {
  locale: 'en',
  seo: {
    title: 'umuo: AI translator for Mac — read and write in any app',
    description:
      'umuo translates in any app on your Mac: ⌃⌃ for selected text, ⌥⌘A for typed input, ⌥⌥ to replace what you typed in place, ⌥⌘O for screenshots. Use your own key (GPT, Claude, Gemini and more) or a local model. One-time purchase, no subscription, no account needed. Voice input is in development.',
    ogLocale: 'en_US',
  },
  nav: {
    skipToContent: 'Skip to main content',
    themeLabel: 'Theme',
    themeToLight: 'Switch to light theme',
    themeToDark: 'Switch to dark theme',
  },
  hero: {
    title: 'Translate right\nwhere you write',
    subtitle:
      'Tap ⌥ twice and the text in your input box turns into another language, in place. Selections and screenshots translate too.',
    pricingNote: 'One-time purchase, your own key, no subscription',
    demo: {
      label: 'Translation preview',
      modes: [
        {
          id: 'read',
          hint: 'Tap ⌃ twice on this page to try it',
          name: 'Selection',
          keys: ['⌃', '⌃'],
          before: '敏捷的棕色狐狸跳过了那只懒狗。',
          after: 'The quick brown fox jumps over the lazy dog.',
        },
        {
          id: 'write',
          hint: 'Tap ⌥ twice on this page to try it',
          name: 'Lightning Replace',
          keys: ['⌥', '⌥'],
          before: 'Could we do the meeting at 3 tomorrow afternoon?',
          after: '明天下午三点开会可以吗？',
          note: 'Replaced only if it is still the same input box. If anything fails, your original text stays.',
        },
        {
          id: 'ocr',
          hint: 'Screenshot translation runs on your Mac: press ⌥⌘O and drag',
          name: 'Screenshot',
          keys: ['⌥', '⌘', 'O'],
          before: '終電は 23:40、2 番線から発車します。',
          after: 'The last train leaves Platform 2 at 11:40 p.m.',
        },
        {
          id: 'speak',
          hint: 'In development: once released, hold right ⌥ to speak',
          name: 'Voice',
          tag: 'In development',
          keyHint: 'Hold',
          keys: ['Right ⌥'],
          before: 'Um, so, can we move the meeting to Friday',
          after: '会议可以改到周五吗？',
          note: 'In development: the preview does not include voice input yet.',
        },
      ],
    },
    platforms: [
      {
        id: 'macos',
        requirement: 'macOS 14+, Apple Silicon (M-series) only',
        actionLabel: 'Download for macOS',
        statusLabel: 'Preview',
        note: 'Not notarized yet. If macOS blocks it, open Privacy & Security and click “Open Anyway”.',
        mobileNote: 'umuo is a Mac app. Open umuo.app on your Mac to download it.',
        copyLink: 'Copy link',
        copied: 'Copied',
        copyFailed: "Couldn't copy. Please note down umuo.app",
        afterDownload: {
          title: 'Your download has started. Next:',
          steps: [
            'Open the downloaded installer and drag umuo into your Applications folder.',
            'If macOS blocks it on first launch, open System Settings › Privacy & Security and click “Open Anyway”.',
            'Follow the setup to pick a model provider and enter your API key. Selection translation needs Accessibility permission.',
          ],
        },
      },
    ],
  },
  footer: {
    contact: 'Contact email',
    copyright: '© 2026 umuo',
    languageLabel: 'Language',
  },
  pricing: {
    title: 'Pricing',
    description:
      'umuo pricing: a US$9 one-time purchase for the app, bring your own model key, no subscription and no account.',
    lead: 'Buy umuo once and bring your own model. No subscription, no umuo account, and no resold model credits.',
    bills: [
      {
        payee: 'Paid to umuo',
        amount: 'US$9',
        cadence: 'One-time purchase',
        body: 'The number of devices a license can activate, any trial, refunds and update entitlements are not final yet. They will be published on this page and in the Terms of Service before purchase opens.',
      },
      {
        payee: 'Paid to your model provider',
        amount: 'Pay as you go',
        cadence: 'With your own API key',
        body: 'You settle usage directly with the provider; local models cost nothing to run. Requests go straight from your Mac to the address you set, not through umuo’s servers.',
      },
    ],
    unavailable: 'The preview is free to download and try right now. Purchase opens later.',
    excluded: {
      title: 'Not included',
      items: [
        'Subscriptions or renewals',
        'A umuo account',
        'Model credits or top-ups',
        'Requests relayed through umuo’s servers',
      ],
    },
    included: 'What’s included',
    includedNote: 'Keys shown are the defaults; you can change them in Settings.',
    features: [
      { name: 'Selection translation', keys: ['⌃', '⌃'] },
      { name: 'Typed-input translation', keys: ['⌥', '⌘', 'A'] },
      { name: 'Lightning Replace in text fields', keys: ['⌥', '⌥'] },
      { name: 'Screenshot OCR translation', keys: ['⌥', '⌘', 'O'] },
      { name: 'Voice input and voice translation', tag: 'In development' },
      { name: 'Your own key, a local model or a custom endpoint' },
    ],
  },
  activate: {
    title: 'Get your license',
    description: 'Collect your umuo license key after payment.',
    pending: 'Confirming your payment — this usually takes a few seconds…',
    slow: `Your payment hasn’t come through yet. Refresh this page in a moment; if you were charged but never get a key, email ${CONTACT_EMAIL}.`,
    ready: 'Payment received. Here is your license key:',
    keyLabel: 'License key',
    copy: 'Copy',
    copied: 'Copied',
    openApp: 'Activate in umuo',
    steps: [
      'Keep this key somewhere safe — you’ll need it again on a new Mac or after reinstalling.',
      'Click “Activate in umuo”, or paste the key into umuo’s settings. The license only activates the app; it is not a model API key and can’t be used as one.',
    ],
    missing: 'This link is incomplete. Please open it from the redirect after payment.',
    unknown: `We couldn’t find this payment, or the link has expired (after 7 days). If you were charged, email ${CONTACT_EMAIL}.`,
    error: 'Can’t reach the server right now. Please refresh this page in a moment.',
    home: 'Back to home',
    contact: 'Email us',
    retry: 'Refresh',
  },
  legal: {
    terms: {
      title: 'Terms of Service',
      description:
        'umuo Terms of Service: software license, using your own model key, purchase details and acceptable use.',
      meta: `Version ${LEGAL_VERSION}, effective ${LEGAL_EFFECTIVE}`,
      sections: [
        {
          heading: '1. Acceptance of Terms',
          body: [
            `Welcome to umuo. umuo is provided by ${LEGAL_NAME} (“we” / “us” / “our”), an individual / sole trader operating under the laws of ${LEGAL_COUNTRY.en}. These Terms of Service (“Terms”) govern your use of the umuo macOS app (the “Software”) and the website ${SITE_URL} (together, the “Service”).`,
            'By downloading, installing or using the Service, you confirm that you are at least 18 years old and that you have read, understood and agree to these Terms and our Privacy Policy. If you do not agree, please stop using the Service.',
          ],
        },
        {
          heading: '2. About the Software',
          body: [
            { heading: '2.1 Features' },
            'umuo is a translation tool that lives in the macOS menu bar. It offers selection translation, typed-input translation, Lightning Replace (in-place replacement in text fields) and screenshot OCR translation. Voice input and voice translation are still in development and are not part of what these Terms promise until they are released.',
            { heading: '2.2 Bring your own model' },
            'The Software does not provide AI models, model credits or a proxy service. You configure your own API key, custom endpoint or local model with a third-party provider; requests go directly from your device to the address you set. Your agreement with the model provider, its fees and its data handling are between you and that provider, and we are not responsible for the availability, cost or output of third-party services.',
            { heading: '2.3 Preview builds' },
            'Builds released before purchase opens are preview builds. They are free to download and use, may contain defects, and their features may change.',
          ],
        },
        {
          heading: '3. Software License',
          body: [
            'Subject to these Terms, we grant you a personal, non-exclusive, non-transferable license to install and use the Software on Macs that you own or control. The Software is provided in closed-source form, and the copyright and related rights belong to us. You may not:',
            [
              'Sell, rent, sublicense or distribute the Software, or distribute modified versions of it.',
              'Reverse engineer, decompile or disassemble the Software, except to the extent applicable law allows.',
              'Bypass or interfere with the Software’s license verification or security features.',
            ],
          ],
        },
        {
          heading: '4. Purchases and Licenses',
          body: [
            'umuo is planned to be sold as a one-time purchase. There is no subscription, no official model credits, no top-ups and no umuo account. Purchase is not open yet.',
            `Once the price, the number of devices a license can activate, any trial, refunds and update entitlements are decided, we will publish them at ${SITE_URL}/pricing and update these Terms before purchase opens. A license you buy only activates the Software; it is kept separate from your model API keys and the two cannot substitute for each other.`,
          ],
        },
        {
          heading: '5. Your Content and AI Output',
          body: [
            'The text and screenshots you process with the Software (“Input”) and the results the model generates (“Output”) belong to you. Input is processed on your Mac or sent by your device directly to the model provider you configured; it does not pass through our servers, and we do not use it to train AI models.',
            'AI-generated content, including translations, may contain errors or omissions or be out of date. Review it yourself before relying on it, and do not treat it as legal, medical, financial or other professional advice.',
          ],
        },
        {
          heading: '6. Acceptable Use',
          body: [
            'You agree not to use the Service to:',
            [
              'Generate or spread content that is unlawful, defamatory, harassing or fraudulent.',
              'Create deepfakes that impersonate real people or mislead others about the origin or authenticity of content.',
              'Generate content that sexualizes minors or violates child protection laws.',
              'Infringe any third party’s intellectual property or privacy rights.',
              'Violate the terms of service of the model provider you use, or any applicable law.',
            ],
          ],
        },
        {
          heading: '7. Privacy',
          body: [
            `Your use of the Service is governed by our Privacy Policy, published at ${SITE_URL}/privacy.`,
          ],
        },
        {
          heading: '8. Disclaimers and Limitation of Liability',
          body: [
            'The Service is provided “as is” and “as available”, without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose or the accuracy of AI output.',
            `To the maximum extent permitted by law, ${LEGAL_NAME} is not liable for any indirect, incidental, consequential or punitive damages. Our total liability is limited to the amount you paid us for the Service in the 12 months before the event giving rise to the claim.`,
          ],
        },
        {
          heading: '9. Termination',
          body: [
            'You may stop using and uninstall the Software at any time. If you materially breach these Terms, the license granted here ends automatically and you must stop using and delete the Software.',
          ],
        },
        {
          heading: '10. Governing Law and Dispute Resolution',
          body: [
            `These Terms are governed by the laws of ${LEGAL_COUNTRY.en}. Before starting any formal proceeding, please email ${CONTACT_EMAIL} to try to resolve the matter informally.`,
          ],
        },
        {
          heading: '11. Changes to These Terms',
          body: [
            'We may update these Terms and will update the version and effective date at the top of this page. Once purchase is open, we will notify purchasers by email at least 14 days before any material change takes effect. Continuing to use the Service after a change takes effect means you accept it. If any provision is found to be invalid, the remaining provisions stay in effect.',
          ],
        },
        {
          heading: '12. Contact',
          body: [
            `If you have any questions about these Terms, please email ${CONTACT_EMAIL}.`,
            `Last updated: ${LEGAL_EFFECTIVE}, ${LEGAL_NAME}, ${SITE_URL}`,
          ],
        },
      ],
    },
    privacy: {
      title: 'Privacy Policy',
      description:
        'umuo Privacy Policy: which data stays on your Mac, where translation requests go, and what the website and we receive.',
      meta: `Version ${LEGAL_VERSION}, last updated ${LEGAL_EFFECTIVE}`,
      intro: [
        `${LEGAL_NAME} (“we” / “us” / “our”) respects and protects your privacy. This Privacy Policy explains, when you use the umuo macOS app (the “Software”) and the website ${SITE_URL} (together, the “Service”), which data is processed on your device, which data reaches us or third parties, and what rights you have.`,
        'umuo needs no account. We do not run our own translation servers and we do not receive the content you translate.',
      ],
      sections: [
        {
          heading: '1. Data Controller',
          body: [
            'The data controller for the Service is:',
            [
              `Name: ${LEGAL_NAME} (individual / sole trader, ${LEGAL_COUNTRY.en})`,
              `Privacy contact email: ${CONTACT_EMAIL}`,
            ],
          ],
        },
        {
          heading: '2. Data That Stays on Your Device',
          body: [
            [
              'Model API keys: stored only in the macOS Keychain on your Mac. The Software never shows them in plain text, and exported configuration does not include keys.',
              'Settings and translation history: stored on your Mac. You can search, delete or turn off history in the Software.',
              'Screenshot recognition: done on your Mac with Apple Vision. Screenshots are never sent to us.',
              'Read aloud: done on your Mac with the macOS system voice.',
            ],
          ],
        },
        {
          heading: '3. Data Sent to the Model Provider You Choose',
          body: [
            'When you translate or polish text, the Software sends the text to be processed directly from your device to the model provider or local model address you configured, not through our servers. How that provider stores the data and whether it uses it for training is governed by its own policy; please read it before you configure the provider.',
          ],
        },
        {
          heading: '4. Data We Receive',
          body: [
            [
              'Website visits and downloads: our website and download service run on Cloudflare. A visit produces operational logs containing your IP address, browser information and request time, which are deleted automatically under Cloudflare’s retention period.',
              'Update checks: when the Software checks for updates it requests version information from umuo.app, and the request includes your IP address and the app version.',
              'Communications: emails and feedback you send us.',
            ],
            'Once purchase opens, the information needed for transactions (such as email, order and license status) will be added to this policy, together with the actual payment processor.',
          ],
        },
        {
          heading: '5. Cookies and Local Storage',
          body: [
            [
              'Functional: the cookie umuo-lang remembers the website language you chose and lasts one year; you can clear it in your browser.',
              'Functional: the website’s light / dark theme preference is kept in your browser’s local storage; you can clear it in your browser.',
            ],
            'This website does not use analytics or marketing cookies, and it does not include third-party analytics or advertising tools.',
          ],
        },
        {
          heading: '6. Sharing and Disclosure',
          body: [
            'We do not sell your personal information. We share it only in these cases:',
            [
              'Service providers: website hosting and download distribution (Cloudflare), only as needed to provide the Service.',
              'Legal and regulatory requirements: as required by law, court order or a lawful request from a competent authority.',
              'With your consent: where you have given explicit prior consent.',
            ],
          ],
        },
        {
          heading: '7. Retention',
          body: [
            [
              'Website operational logs: deleted automatically under Cloudflare’s retention period.',
              'Support emails: kept for 2 years, then deleted.',
              'Data on your device: managed by you; uninstall the Software or delete it in the Software to remove it.',
            ],
          ],
        },
        {
          heading: '8. Your Data Rights',
          body: [
            `You may ask to access, correct or delete the personal information we hold about you, or object to or restrict its processing. Email ${CONTACT_EMAIL} and we will respond within 30 calendar days. If you believe we have not handled your request properly, you have the right to complain to your local data protection authority.`,
          ],
        },
        {
          heading: '9. International Data Transfers',
          body: [
            'Cloudflare’s network spans the globe, so data from your visits to the website may be processed outside your country or region.',
          ],
        },
        {
          heading: '10. Children’s Privacy',
          body: [
            'The Service is intended for users aged 18 and over. We do not knowingly collect information from anyone under 18. If you believe your child has given us information, please contact us and we will delete it promptly.',
          ],
        },
        {
          heading: '11. Changes to This Policy',
          body: [
            'If this policy changes, we will update the version and date at the top of this page; once purchase is open, we will notify purchasers by email at least 14 days before any material change.',
          ],
        },
        {
          heading: '12. Contact Us',
          body: [
            [`Privacy and support email: ${CONTACT_EMAIL}`, `Operator: ${LEGAL_NAME}`],
            `${LEGAL_NAME}, ${SITE_URL}`,
          ],
        },
      ],
    },
  },
}
