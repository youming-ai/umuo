import type { SiteContent } from './types'

/** 한국어 문안. 구조와 제품 정보는 zh-cn.ts를 기준으로 합니다. */
export const ko: SiteContent = {
  locale: 'ko',
  seo: {
    title: 'umuo: 읽고 쓰고 말하는 Mac AI 번역기',
    description:
      'umuo는 macOS용 AI 번역 앱입니다. ⌃⌃ 선택 영역 번역, ⌥⌘A 글쓰기 창, ⌥⌥ 입력란 제자리 교체, ⌥⌘O 스크린샷 번역, 오른쪽 ⌥를 누른 채 음성 입력. 무료 엔진이 기본 제공되어 로그인 없이 쓸 수 있고, 로그인하면 GPT, Claude, Gemini 등의 모델을 사용할 수 있습니다. 내 API 키나 로컬 모델도 연결할 수 있습니다.',
    ogLocale: 'ko_KR',
  },
  nav: {
    skipToContent: '본문으로 바로가기',
    themeLabel: '테마',
    themeToLight: '라이트 테마로 전환',
    themeToDark: '다크 테마로 전환',
  },
  hero: {
    title: '어떤 앱에서든 단축키 하나로 번역',
    subtitle: '선택하면 번역, 쓰고 나면 외국어로. 말로 해도 됩니다.',
    demo: {
      label: '번역 미리보기',
      hint: '⌃를 두 번 눌러 바로 해 보세요',
      modes: [
        {
          id: 'read',
          name: '선택 번역',
          keys: ['⌃', '⌃'],
          before: 'The quick brown fox jumps over the lazy dog.',
          after: '날쌘 갈색 여우가 게으른 개를 뛰어넘습니다.',
        },
        {
          id: 'write',
          name: '바로 교체',
          keys: ['⌥', '⌥'],
          before: '내일 오후 3시에 회의 괜찮으세요?',
          after: 'Does 3 p.m. tomorrow work for the meeting?',
        },
        {
          id: 'speak',
          name: '음성 입력',
          tag: 'V1.1',
          keys: ['오른쪽 ⌥ 길게 누르기'],
          before: '음, 회의 금요일로 옮길 수 있을까',
          after: 'Could we move the meeting to Friday?',
        },
      ],
    },
    platforms: [
      {
        id: 'macos',
        requirement: 'macOS 13 이상, Apple Silicon·Intel 지원',
        actionLabel: 'macOS용 다운로드',
        statusLabel: '프리뷰',
        note: '아직 Apple 공증 전인 프리뷰입니다. 차단되면 「개인정보 보호 및 보안」에서 「그래도 열기」를 누르세요.',
      },
    ],
  },
  footer: {
    contact: '이메일 문의',
    copyright: '© 2026 umuo',
    languageLabel: '언어',
  },
}
