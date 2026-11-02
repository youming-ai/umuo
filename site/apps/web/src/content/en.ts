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
 * screenshot and voice; free, BYOK only). Wording is written for English readers, not translated.
 */
export const en: SiteContent = {
  locale: 'en',
  seo: {
    title: 'umuo: AI translator for Mac — read and write in any app',
    description:
      'umuo translates in any app on your Mac: ⌃⌃ for selected text, ⌥⌘A for typed input, ⌥⌥ to replace what you typed in place, ⌥⌘O for screenshots. Use your own key (GPT, Claude, Gemini and more) or a local model. Completely free, no subscription, no account needed. Voice input is in development.',
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
          hint: 'In development: hold ⌃⌘V and speak, release to get it in your target language; hold ⌥⌘V to tidy it up in the same language',
          name: 'Voice',
          tag: 'In development',
          keyHint: 'Hold',
          keys: ['⌃', '⌘', 'V'],
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
    source: 'Source code',
  },
  legal: {
    terms: {
      title: 'Terms of Service',
      description:
        'umuo Terms of Service: the software is provided under the MIT License; these terms cover the website and official builds, trademarks, using your own model key and acceptable use.',
      meta: `Version ${LEGAL_VERSION}, effective ${LEGAL_EFFECTIVE}`,
      sections: [
        {
          heading: '1. Acceptance of Terms',
          body: [
            `Welcome to umuo. umuo is published by ${LEGAL_NAME} (“we” / “us” / “our”), an individual / sole trader operating under the laws of ${LEGAL_COUNTRY.en}. These Terms of Service (“Terms”) govern your use of the website ${SITE_URL} and of the umuo macOS app installers we publish there (the “Official Builds”), together the “Service”. The umuo software itself is provided under the MIT License; see section 3.`,
            `By downloading, installing or using the Service, you confirm that you are at least 18 years old and that you have read, understood and agree to these Terms and our Privacy Policy, published at ${SITE_URL}/privacy. If you do not agree, please stop using the Service.`,
          ],
        },
        {
          heading: '2. About the Software',
          body: [
            { heading: '2.1 Features' },
            'umuo is a translation tool that lives in the macOS menu bar. It offers selection translation, typed-input translation, Lightning Replace (in-place replacement in text fields) and screenshot OCR translation. Voice input and voice translation are still in development and are not part of what these Terms describe until they are released.',
            { heading: '2.2 Free of charge' },
            'umuo is free. There is no paid edition, in-app purchase, subscription, trial period or license activation, and we do not charge you anything.',
            { heading: '2.3 Preview builds' },
            'The Official Builds are currently previews. They are not notarized by Apple, may contain defects, and their features may change.',
          ],
        },
        {
          heading: '3. Software License (MIT)',
          body: [
            'The umuo software is provided under the MIT License, and the full license text will accompany the source code once it is published. The MIT License lets anyone use, copy, modify, merge, publish, distribute, sublicense and sell copies of the software free of charge, on the sole condition that the copyright notice and permission notice are kept in all copies or substantial portions of the software.',
            [
              'The software is provided “as is”, without warranty of any kind, express or implied, including merchantability, fitness for a particular purpose and non-infringement.',
              'In no event shall the authors or copyright holders be liable for any claim, damages or other liability arising from the software or its use.',
              'For the software itself, the MIT License governs your rights and obligations. The rest of these Terms only covers your use of the website and the Official Builds, and does not restrict the rights the MIT License grants you.',
            ],
          ],
        },
        {
          heading: '4. Name and Trademarks',
          body: [
            'The MIT License covers the copyright in the software. It does not cover the “umuo” name or the otter icon. You may modify and redistribute the software, but without our written permission you may not:',
            [
              'Publish a modified version under the “umuo” name or with the otter icon, or make people believe it is an Official Build.',
              'Suggest that we endorse your product or service, or that you are affiliated with us.',
            ],
            'Truthfully stating that your work is based on or derived from umuo is always allowed.',
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
          heading: '7. Third-Party Model Providers',
          body: [
            'The software does not provide AI models, model credits or a proxy service. You configure your own API key, custom endpoint or local model with a third-party provider; requests go directly from your device to the address you set.',
            'Your account, fees, quotas, data handling and terms with the model provider are between you and that provider. Usage fees are settled only between you and the provider; we do not charge, collect or mark them up. We are not responsible for the availability, cost or output of third-party services.',
          ],
        },
        {
          heading: '8. Disclaimers and Limitation of Liability',
          body: [
            'The website and the Official Builds are provided free of charge, “as is” and “as available”, without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, non-infringement or the accuracy of AI output.',
            `To the maximum extent permitted by law, ${LEGAL_NAME} is not liable for any direct, indirect, incidental, consequential or punitive damages arising from the use of, or inability to use, the Service. Liability that cannot be excluded or limited under applicable law is not affected.`,
          ],
        },
        {
          heading: '9. Termination',
          body: [
            'You may stop using and uninstall the Software at any time. If you materially breach these Terms, we may stop providing the website and the Official Builds to you; the rights you hold in the software itself under the MIT License are not affected.',
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
            'We may update these Terms and will update the version and effective date at the top of this page. Continuing to use the Service after a change takes effect means you accept it. If any provision is found to be invalid, the remaining provisions stay in effect.',
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
        'umuo is free and needs no account. We do not run our own translation servers and we do not receive the content you translate.',
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
              'Voice input (in development; applies once released): requires microphone permission. Audio is written only to a temporary file on your Mac, transcribed by an on-device speech model, and deleted as soon as transcription finishes or is cancelled. It is never sent to us or to your model provider. On first use the Software downloads a speech model of about 560 MB from Hugging Face, which can see your IP address for that download.',
            ],
          ],
        },
        {
          heading: '3. Data Sent to the Model Provider You Choose',
          body: [
            'When you translate or polish text, or tidy up a voice transcript, the Software sends the text to be processed directly from your device to the model provider or local model address you configured, not through our servers. How that provider stores the data and whether it uses it for training is governed by its own policy; please read it before you configure the provider.',
          ],
        },
        {
          heading: '4. Data We Receive',
          body: [
            [
              'Website visits and downloads: our website and download service run on Cloudflare. Visits and downloads produce operational logs containing your IP address, browser information and request time, which are deleted automatically under Cloudflare’s retention period.',
              'Update checks: when the Software checks for updates it requests version information from umuo.app, and the request includes your IP address and the app version.',
              'Release notifications (if you sign up): when you leave your email address on the website to be notified of releases, we store that address, where you signed up, and when you first and last submitted it, and use it only to tell you about umuo releases. The IP address of the submission is used only briefly, for rate limiting.',
              'Communications: emails and feedback you send us.',
            ],
            'umuo is free, so we do not process any payment information, and we do not store licenses, activation records or device identifiers.',
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
              'Service providers: website hosting, download distribution and storage of the notification list (Cloudflare), only as needed to provide the Service.',
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
              'Release notification emails: kept until you ask us to delete them or we stop sending that notification.',
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
            'Cloudflare’s network spans the globe, so data from your visits to the website, your downloads or your notification sign-up may be processed outside your country or region.',
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
            'If this policy changes, we will update the version and date at the top of this page.',
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
