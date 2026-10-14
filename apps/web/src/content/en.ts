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
 * English copy. Structure follows zh-cn.ts; facts come from docs/PRD.md (§5 features,
 * §7.2 shortcuts, §10 pricing). Wording is written for English readers, not translated.
 */
export const en: SiteContent = {
  locale: 'en',
  seo: {
    title: 'umuo: AI translator for Mac — read, write and speak',
    description:
      'umuo translates in any app on your Mac: ⌃⌃ for selected text, ⌥⌘A for a writing window, ⌥⌥ to replace what you typed, ⌥⌘O for screenshots. Use your own key (GPT, Claude, Gemini and more) or a local model, no account needed. Voice input and included AI usage are coming soon.',
    ogLocale: 'en_US',
  },
  nav: {
    skipToContent: 'Skip to main content',
    themeLabel: 'Theme',
    themeToLight: 'Switch to light theme',
    themeToDark: 'Switch to dark theme',
  },
  hero: {
    title: 'Translate in any app with one shortcut',
    subtitle: 'Select to read, type to replace, or just speak.',
    demo: {
      label: 'Translation preview',
      hint: 'Tap ⌃ twice to try it here',
      modes: [
        {
          id: 'read',
          name: 'Selection',
          keys: ['⌃', '⌃'],
          before: '敏捷的棕色狐狸跳过了那只懒狗。',
          after: 'The quick brown fox jumps over the lazy dog.',
        },
        {
          id: 'write',
          name: 'Replace',
          keys: ['⌥', '⌥'],
          before: 'Could we do the meeting at 3 tomorrow afternoon?',
          after: '明天下午三点开会可以吗？',
        },
        {
          id: 'speak',
          name: 'Voice',
          tag: 'V1.1',
          keys: ['Hold right ⌥'],
          before: 'Um, so, can we move the meeting to Friday',
          after: '会议可以改到周五吗？',
        },
      ],
    },
    platforms: [
      {
        id: 'macos',
        requirement: 'macOS 13+, Apple Silicon or Intel',
        actionLabel: 'Download for macOS',
        statusLabel: 'Preview',
        note: 'Not notarized yet. If macOS blocks it, open Privacy & Security and click “Open Anyway”.',
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
      'umuo pricing: monthly and annual prices for the Free, Pro and Pro + Advanced AI plans, allowances, free trial, cancellation and refunds.',
    lead: 'The app is free to download. Bring your own key (BYOK) and local models are unlimited and need no account. Included AI usage and in-app subscriptions are not live yet; the plans below are what will be offered at launch.',
    plans: [
      {
        name: 'Free account',
        tagline: 'Try it out',
        monthly: '$0',
        yearly: 'Free forever',
        features: [
          '300K fast tokens / month',
          'umuo account required',
          'Unlimited BYOK and local models',
        ],
      },
      {
        name: 'Pro',
        tagline: 'Enough for daily work',
        monthly: '$5.99 / month',
        yearly: 'or $46.99 / year, about 35% off',
        features: [
          '3M fast tokens / month',
          'Includes the Free account allowance',
          '1-day trial monthly, 3-day trial yearly; cancel free during the trial',
        ],
      },
      {
        name: 'Pro + Advanced AI',
        tagline: 'Higher quality',
        monthly: '$11.99 / month',
        yearly: 'or $93.99 / year, about 35% off',
        features: [
          'Includes the Pro allowance',
          'Higher-quality models',
          '10M advanced tokens / month',
        ],
      },
    ],
    notes: [
      {
        heading: 'How to buy',
        body: 'In-app subscriptions are not live yet, so plans can’t be purchased in the current version. Once they launch, sign in inside the umuo app and subscribe. Your plan renews automatically each month or year, depending on the period you chose. Payments are processed by Waffo Pancake.',
      },
      {
        heading: 'Prices and taxes',
        body: 'Prices are in US dollars and exclude applicable taxes, which are calculated for your location and shown at checkout. Existing subscribers are notified by email before any change to prices or allowances.',
      },
      {
        heading: 'Cancellation',
        body: `Cancel any time in the app’s Account Settings or by emailing ${CONTACT_EMAIL}. You keep access until the end of the current period and are not charged again.`,
      },
      {
        heading: 'Refunds',
        body: 'Refunds within 7 days on monthly and 30 days on annual plans, no questions asked. For Pro + Advanced AI, the cost of advanced quota already used in the period is deducted. See Section 7 of the Terms of Service.',
      },
    ],
  },
  legal: {
    terms: {
      title: 'Terms of Service',
      description:
        'umuo Terms of Service: subscriptions and auto-renewal, cancellation and refunds, AI output ownership and acceptable use.',
      meta: `Version ${LEGAL_VERSION}, effective ${LEGAL_EFFECTIVE}`,
      sections: [
        {
          heading: '1. Introduction & Acceptance of Terms',
          body: [
            `Welcome to umuo. umuo is provided by ${LEGAL_NAME} ("we" / "us" / "our"), an individual / sole trader operating under the laws of ${LEGAL_COUNTRY.en}. These Terms of Service ("Terms") govern your access to and use of umuo, including the macOS app, the related online translation and account services, and the website ${SITE_URL} (together, the "Service").`,
            'By creating an account, subscribing to any plan, or otherwise using the Service, you confirm that you: (a) are at least 18 years of age; (b) have read, understood, and agree to be bound by these Terms; (c) agree to our Privacy Policy; and (d) are authorized to enter into this agreement on behalf of yourself or any organization you represent.',
            '⚠️ Important: If you do not agree to these Terms, you may not use the Service. Continued use after any update constitutes acceptance of the revised Terms.',
          ],
        },
        {
          heading: '2. Service Description',
          body: [
            { heading: '2.1 What we provide' },
            'umuo is an AI-powered translation tool that lets you translate selected text in any app, replace what you typed with another language in place, translate screenshots, and dictate by voice. The Service is delivered as a downloadable desktop app together with digital services provided over the internet.',
            { heading: '2.2 Nature of the Service' },
            'The Service is an intangible digital product. Paid features are activated immediately after payment is confirmed. Because digital services are delivered instantly, refunds are subject to the limits in Section 7.',
            { heading: '2.3 AI model dependency' },
            'The Service uses third-party AI model providers, including OpenAI, Anthropic and Google. Its performance and availability may be affected by the operational status of these providers. We will notify users promptly of any major outage.',
          ],
        },
        {
          heading: '3. Account Registration',
          body: [
            { heading: '3.1 Creating an account' },
            'Some features work without an account; online models and paid plans require an account created with accurate and complete information. You are responsible for keeping your login credentials confidential and for all activity under your account.',
            { heading: '3.2 Account security' },
            [
              `Contact ${CONTACT_EMAIL} immediately if you notice any unauthorized use.`,
              'Do not share your login credentials with any third party.',
              'Keep your billing email address up to date.',
            ],
            { heading: '3.3 Business accounts' },
            'If you register on behalf of a company or organization, you represent that you are authorized to bind that entity to these Terms.',
          ],
        },
        {
          heading: '4. Subscription Plans',
          body: [
            `umuo’s basic features are free. Paid features are offered through monthly and annual subscription plans. Prices and billing periods for each plan are published at ${SITE_URL}/pricing.`,
            'We may change plan features or introduce new plans at any time. Price changes follow Section 5.1.',
          ],
        },
        {
          heading: '5. Billing & Payment',
          body: [
            { heading: '5.1 Auto-renewal authorization' },
            `By providing a payment method and subscribing to a paid plan, you expressly authorize ${LEGAL_NAME} to charge your payment method the applicable subscription fee on a recurring basis (monthly or annually, depending on your plan). This authorization remains in effect until you cancel under Section 6.`,
            'Your subscription renews automatically at the end of each billing period unless you cancel. We send a reminder email 7 days before an annual subscription renews. Price changes are notified by email before the next billing period begins.',
            'Free trial: the Pro plan includes a 1-day free trial when billed monthly and a 3-day free trial when billed annually. Cancel during the trial and you will not be charged; otherwise the trial converts to a paid subscription and is billed for the period you chose.',
            { heading: '5.2 Payment processing' },
            'Payments are processed by our payment processor, Waffo Pancake.',
            { heading: '5.3 Taxes' },
            'Unless stated otherwise, prices exclude applicable taxes (including VAT, GST and sales tax). Where required by law, we collect and remit those taxes.',
          ],
        },
        {
          heading: '6. Cancellation Policy',
          body: [
            { heading: '6.1 How to cancel' },
            'You can cancel your subscription at any time by either of the following:',
            [
              'Online (recommended): Account Settings → Subscription → Cancel Subscription',
              `Email: send a cancellation request from your registered email address to ${CONTACT_EMAIL}`,
            ],
            'Online cancellation takes effect immediately and you will receive a confirmation email; email requests are processed and confirmed within 2 business days.',
            { heading: '6.2 Effect of cancellation' },
            [
              'Your subscription stays active until the end of the current billing period.',
              'You will not be charged for any later billing period.',
              'Account data is kept for 90 days after cancellation, then deleted in accordance with the Privacy Policy.',
            ],
          ],
        },
        {
          heading: '7. Refund Policy',
          body: [
            { heading: '7.1 General policy' },
            'Because our digital service is intangible and delivered instantly, subscription fees are generally non-refundable, except as set out below.',
            { heading: '7.2 Eligible refunds' },
            [
              'Refund window: you may request a refund, no questions asked, within 7 days of any charge on a monthly plan or within 30 days of any charge on an annual plan. For Pro + Advanced AI, the cost of advanced quota already used in the current period is deducted.',
              'Duplicate charges: duplicate charges caused by a billing error are refunded in full.',
              'Verified service outage (over 72 hours): for an extended outage caused by us, we provide a pro-rata refund or an extension.',
              'Statutory rights: any right of withdrawal or refund granted by applicable law (such as the 14-day cooling-off period in the EU/UK) is preserved.',
            ],
            { heading: '7.3 How to request a refund' },
            `Email ${CONTACT_EMAIL} with your account email, the transaction ID and the reason for the refund. We confirm within 2 business days and process eligible refunds within 5–10 business days.`,
            { heading: '7.4 Non-refundable items' },
            [
              'Fees for subscription periods already used (except as in Section 7.2).',
              'Refund requests made after the window in Section 7.2 (7 days for monthly, 30 days for annual plans).',
              'Accounts closed for violating these Terms or the acceptable use policy.',
            ],
          ],
        },
        {
          heading: '8. Billing Disputes',
          body: [
            `If you believe a charge is wrong, please email ${CONTACT_EMAIL} before filing a dispute with your bank. We reply within 2 business days and resolve confirmed billing errors within 5 business days.`,
          ],
        },
        {
          heading: '9. AI Content & Intellectual Property',
          body: [
            { heading: '9.1 Ownership of output' },
            'Subject to these Terms, the AI content generated from your input ("Output") belongs to you. You may use Output for any lawful purpose permitted under Section 10.',
            { heading: '9.2 License to input' },
            `By submitting content to the Service ("Input"), you grant ${LEGAL_NAME} a limited, non-exclusive license to use it solely to provide the Service to you. We do not use your Input to train AI models without your explicit consent.`,
            { heading: '9.3 Third-party AI models' },
            'The Service uses third-party AI model providers, including OpenAI, Anthropic and Google. Output may be affected by these providers’ models. We do not guarantee any particular output quality and are not responsible for content generated by third-party models.',
            { heading: '9.4 Accuracy of AI output' },
            'AI-generated content, including translations, may contain errors or inaccuracies. You are responsible for reviewing and verifying Output before relying on it.',
          ],
        },
        {
          heading: '10. Acceptable Use Policy',
          body: [
            { heading: '10.1 Permitted use' },
            'You may use the Service only for lawful purposes consistent with these Terms, including personal productivity, business communication, learning and research.',
            { heading: '10.2 Prohibited use' },
            'You agree not to use the Service to:',
            [
              'Generate illegal, defamatory, harassing or fraudulent content.',
              'Generate, distribute or help create deepfakes, including AI-synthesized audio, video or images that impersonate real people or are intended to mislead others about their origin or authenticity.',
              'Generate content that sexualizes minors or violates child protection laws.',
              'Create malware, phishing content or cyberattack tools.',
              'Infringe any third party’s intellectual property or privacy rights.',
              'Circumvent or interfere with the Service’s security features.',
              'Resell or sublicense access without prior written approval.',
              'Violate any applicable law, regulation or card network rule.',
            ],
            { heading: '10.3 AI-specific restrictions' },
            'In addition to the above, given the AI nature of the Service, you expressly agree not to:',
            [
              'Use the Service’s input, output, model responses or any derived data to train, fine-tune, benchmark, distill or otherwise develop any AI or machine learning model that competes directly or indirectly with the Service.',
              'Systematically scrape, extract or harvest model output at scale for any purpose beyond your own authorized use.',
              'Present AI-generated content as the work of a human professional (such as a licensed doctor, lawyer, financial adviser or certified translator) where doing so could cause harm.',
            ],
          ],
        },
        {
          heading: '11. Data, Privacy & Security',
          body: [
            `Your use of the Service is governed by our Privacy Policy, published at ${SITE_URL}/privacy. Payment card data is handled exclusively by our PCI-DSS-compliant payment processor (Waffo Pancake) and is never stored on our servers. Account data is kept for 90 days after cancellation, then deleted.`,
          ],
        },
        {
          heading: '12. Disclaimers & Limitation of Liability',
          body: [
            { heading: '12.1 Disclaimer' },
            'The Service is provided "as is" and "as available", without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose or accuracy of AI output.',
            { heading: '12.2 AI-generated content disclaimer' },
            'AI output from the Service may be inaccurate, incomplete or out of date. Do not rely on it for legal, medical, financial or other professional advice. Always verify with a qualified professional before acting on AI content.',
            { heading: '12.3 Limitation of liability' },
            `To the maximum extent permitted by law, ${LEGAL_NAME} is not liable for any indirect, incidental, consequential or punitive damages. Our total liability is limited to the amount you paid us in the 12 months before the event giving rise to the claim.`,
          ],
        },
        {
          heading: '13. Term & Termination',
          body: [
            `These Terms remain in effect while you use the Service. We may suspend or terminate your account for a material breach of these Terms, suspected fraud, or where required by law. If we terminate the Service for reasons other than your breach, we refund the prepaid unused portion pro rata. You can delete your account at any time by contacting ${CONTACT_EMAIL}.`,
          ],
        },
        {
          heading: '14. Governing Law & Dispute Resolution',
          body: [
            `These Terms are governed by the laws of ${LEGAL_COUNTRY.en}. Before starting formal proceedings, please email ${CONTACT_EMAIL} to try to resolve the matter informally.`,
          ],
        },
        {
          heading: '15. General Provisions',
          body: [
            'We may update these Terms at any time. Material changes are notified by email at least 14 days before they take effect. Continued use constitutes acceptance. If any provision is held invalid, the remaining provisions stay in full effect. These Terms and the Privacy Policy form the entire agreement between you and us.',
          ],
        },
        {
          heading: '16. Contact',
          body: [
            `For any question about these Terms or billing — support, billing, refunds, cancellation, legal and privacy, or security — email ${CONTACT_EMAIL}. You can also cancel your subscription in Account Settings.`,
            'By using the Service or checking "I agree" at checkout, you confirm that you have read and agree to these Terms.',
            `Last updated: ${LEGAL_EFFECTIVE}, ${LEGAL_NAME}, ${SITE_URL}`,
          ],
        },
      ],
    },
    privacy: {
      title: 'Privacy Policy',
      description:
        'umuo Privacy Policy: what we collect, how we use and share it, how long we keep it, and your data rights.',
      meta: `Version ${LEGAL_VERSION}, last updated ${LEGAL_EFFECTIVE}`,
      intro: [
        `${LEGAL_NAME} ("we") respects and protects your privacy. This Privacy Policy explains how we collect, use, store and share your personal information when you use umuo (the "Service"), and the rights you have under applicable law.`,
        'Please read this policy before using the Service. By using the Service you confirm that you have read and agree to it. We may update this policy from time to time and will notify you by email in advance of any material change.',
      ],
      sections: [
        {
          heading: '1. Data Controller',
          body: [
            'The data controller for the Service is:',
            [
              `Name: ${LEGAL_NAME} (individual / sole trader, ${LEGAL_COUNTRY.en})`,
              `Privacy contact: ${CONTACT_EMAIL}`,
              'Data Protection Officer: not appointed',
            ],
          ],
        },
        {
          heading: '2. Information We Collect',
          body: [
            { heading: '2.1 Information you provide' },
            [
              'Account information: the email address and other details you use to sign in.',
              'Payment information: plan, transaction amount and payment status. We do not store full card numbers — card data is handled by our payment processor (see Section 5).',
              'Communications: emails and feedback you send us.',
            ],
            { heading: '2.2 Content you translate' },
            'Text, screenshots and speech you choose to translate, rewrite or dictate ("Input") are sent to the selected translation engine or AI model provider when your request is processed, to produce the result. We do not use Input to train AI models. When you use your own API key or a local model, requests go directly from your device to that service, or stay on your Mac, without passing through our servers.',
            { heading: '2.3 Information collected automatically' },
            [
              'Device and network: IP address, operating system and app version, time zone.',
              'Log data: request times, error logs and performance data.',
            ],
          ],
        },
        {
          heading: '3. How We Use Your Information',
          body: [
            [
              'Providing and maintaining the Service — performance of contract',
              'Billing and payment processing — performance of contract',
              'Customer support — performance of contract / legitimate interests',
              'Service notices (billing, security, policy updates) — legitimate interests',
              'Security and fraud prevention — legitimate interests',
              'Product improvement and troubleshooting — legitimate interests',
              'Legal compliance — legal obligation',
            ],
            'We may aggregate or de-identify data for statistical analysis. Such data cannot identify any individual.',
          ],
        },
        {
          heading: '4. Cookies & Local Storage',
          body: [
            [
              'Functional: the umuo-lang cookie remembers the website language you chose, for one year; you can clear it in your browser.',
              'Functional: your light / dark theme preference for the website is kept in your browser’s local storage; you can clear it in your browser.',
            ],
            'This website does not use analytics or marketing cookies and does not load third-party analytics or advertising tools.',
          ],
        },
        {
          heading: '5. Sharing & Disclosure',
          body: [
            'We do not sell your personal information, including "selling" as defined by laws such as the CCPA. We share your information only:',
            [
              'With service providers: cloud services (Cloudflare), AI model providers (OpenAI, Anthropic, Google) and our payment processor, only as needed to provide the Service. Payment card data is handled exclusively by our PCI-DSS-compliant payment processor, Waffo Pancake, and is never stored on our servers.',
              'For legal and regulatory reasons: in response to law, court orders or lawful requests from authorities.',
              'In business transfers: in a merger or acquisition, with advance notice and continued protection.',
              'With your consent: for other purposes, with your explicit prior consent.',
            ],
          ],
        },
        {
          heading: '6. Data Security',
          body: [
            [
              'Encryption in transit: TLS / HTTPS.',
              'Secure storage: sensitive data is stored encrypted; your own API keys are kept only in the macOS Keychain on your Mac.',
              'Access control: least-privilege access.',
            ],
            'If a security incident affects your rights, we will notify you and the relevant authorities as required by law within 72 hours of discovering it. Please keep your login credentials safe and do not share them.',
          ],
        },
        {
          heading: '7. Data Retention',
          body: [
            [
              'Account information: while your account is active; deleted 90 days after you delete the account or cancel your subscription.',
              'Transaction records: kept as required by tax and accounting rules, usually 7 years, then deleted.',
              'Support emails: 2 years, then deleted.',
              'Log data: 12 months, then deleted.',
              'Input: used only to process your request and not stored on our own servers; AI model providers handle it under their own policies.',
            ],
          ],
        },
        {
          heading: '8. Your Rights',
          body: [
            `You have the following rights. To exercise them, email ${CONTACT_EMAIL}; we respond within 30 calendar days.`,
            [
              'Right to be informed: know what data we collect and how we use it.',
              'Right of access: get a copy of your personal information.',
              'Right to rectification: correct inaccurate or incomplete information.',
              'Right to erasure: request deletion of your data in certain circumstances.',
              'Right to restrict processing: pause processing in certain circumstances.',
              'Right to data portability: receive your data in a machine-readable format.',
              'Right to object: object to processing based on legitimate interests.',
              'Right to withdraw consent: withdraw consent for consent-based processing.',
            ],
            'If you believe we have not handled your request properly, you may complain to your local data protection authority.',
          ],
        },
        {
          heading: '9. Marketing Communications',
          body: [
            'We do not currently send marketing messages. If we do in the future, we will ask for your consent first and include an unsubscribe link in every email. Unsubscribing does not affect essential service notices (such as billing, security alerts and changes to terms).',
          ],
        },
        {
          heading: '10. International Data Transfers',
          body: [
            'Our servers and partners may be located in the United States and wherever Cloudflare’s global network operates. For cross-border transfers we protect your data with data processing agreements that include the EU Standard Contractual Clauses (SCCs), and transfer only to recipients offering an equivalent level of protection.',
          ],
        },
        {
          heading: '11. Children’s Privacy',
          body: [
            'The Service is intended for users aged 18 and over. We do not knowingly collect information from anyone under 18. If you believe your child has provided us with information, contact us and we will delete it promptly.',
          ],
        },
        {
          heading: '12. Third-Party Links & Services',
          body: [
            'The Service may contain links to or integrate with third-party services. This policy applies only to information we collect directly. We are not responsible for third parties’ data practices and recommend reviewing their policies before use.',
          ],
        },
        {
          heading: '13. Changes to This Policy',
          body: [
            'For material changes, we will notify you at your registered email address at least 14 days in advance and update the date at the top of this page. Continued use after the effective date constitutes acceptance.',
          ],
        },
        {
          heading: '14. Contact Us',
          body: [
            [`Privacy and support: ${CONTACT_EMAIL}`, `Operator: ${LEGAL_NAME}`],
            `${LEGAL_NAME}, ${SITE_URL}`,
          ],
        },
      ],
    },
  },
}
