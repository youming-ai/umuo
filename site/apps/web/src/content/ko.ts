import type { SiteContent } from './types'

/** 한국어 문안. 구조와 제품 정보는 zh-cn.ts를 기준으로 합니다. */
export const ko: SiteContent = {
  seo: {
    title: 'umuo: 읽고 쓰는 Mac AI 번역기',
    description:
      'umuo는 macOS용 AI 번역 앱입니다. ⌃⌃ 선택 영역 번역, ⌥⌘A 입력 번역, ⌥⌥ 입력란 제자리 교체, ⌥⌘O 스크린샷 번역. 내 API 키(GPT, Claude, Gemini 등)나 로컬 모델을 연결해 쓰며, 완전 무료이며 구독도 계정도 필요 없습니다. 음성 입력은 실험 기능으로 제공됩니다.',
    ogLocale: 'ko_KR',
  },
  nav: {
    skipToContent: '본문으로 바로가기',
    themeLabel: '테마',
    themeToLight: '라이트 테마로 전환',
    themeToDark: '다크 테마로 전환',
  },
  hero: {
    title: '쓰는 그 자리에서\n바로 번역',
    subtitle:
      '⌥를 두 번 누르면 입력창의 글이 그 자리에서 외국어로 바뀝니다. 선택한 텍스트와 스크린샷도 번역합니다.',
    demo: {
      label: '번역 미리보기',
      modes: [
        {
          id: 'read',
          hint: '이 페이지에서 ⌃를 두 번 눌러 보세요',
          name: '선택 번역',
          keys: ['⌃', '⌃'],
          before: 'The quick brown fox jumps over the lazy dog.',
          after: '날쌘 갈색 여우가 게으른 개를 뛰어넘습니다.',
        },
        {
          id: 'write',
          hint: '이 페이지에서 ⌥를 두 번 눌러 보세요',
          name: '번개 교체',
          keys: ['⌥', '⌥'],
          before: '내일 오후 3시에 회의 괜찮으세요?',
          after: 'Does 3 p.m. tomorrow work for the meeting?',
          note: '같은 입력창일 때만 바꿉니다. 실패하거나 취소하면 원문은 그대로 둡니다.',
        },
        {
          id: 'ocr',
          hint: '스크린샷 번역은 Mac에서 ⌥⌘O로 영역을 선택합니다',
          name: '스크린샷 번역',
          keys: ['⌥', '⌘', 'O'],
          before: 'Last train leaves Platform 2 at 11:40 p.m.',
          after: '막차는 오후 11시 40분에 2번 승강장에서 출발합니다.',
        },
        {
          id: 'speak',
          hint: '⌃⌘V를 누른 채 말하고 떼면 목표 언어로 번역합니다. ⌥⌘V를 쓰면 같은 언어로 매끄럽게 다듬습니다',
          name: '음성 입력',
          tag: '실험 기능',
          before: '음, 회의 금요일로 옮길 수 있을까',
          after: 'Could we move the meeting to Friday?',
          note: '실험 기능: 프리뷰에 포함되어 있습니다. 음성 인식은 Mac에서 처리하며, 처음 사용할 때 약 560MB의 음성 모델을 내려받습니다.',
        },
      ],
    },
    platform: {
      requirement: 'macOS 14 이상, Apple Silicon(M 시리즈) 전용',
      actionLabel: 'macOS용 다운로드',
      statusLabel: '프리뷰',
      note: '아직 Apple 공증 전인 프리뷰입니다. 차단되면 「개인정보 보호 및 보안」에서 「그래도 열기」를 누르세요.',
      mobileNote: 'umuo는 Mac 앱입니다. Mac에서 umuo.app을 열어 다운로드하세요.',
      copyLink: '링크 복사',
      copied: '복사됨',
      copyFailed: '복사하지 못했습니다. umuo.app을 따로 적어 두세요',
      afterDownload: {
        title: '다운로드를 시작했습니다. 다음 단계:',
        steps: [
          '받은 설치 파일을 열고 umuo를 「응용 프로그램」 폴더로 끌어 놓습니다.',
          '처음 열 때 차단되면 「시스템 설정 › 개인정보 보호 및 보안」에서 「그래도 열기」를 누릅니다.',
          '안내에 따라 모델 제공업체를 고르고 API 키를 입력합니다. 선택 번역에는 손쉬운 사용 권한이 필요합니다.',
        ],
      },
    },
  },
  footer: {
    copyright: '© 2026 umuo',
    languageLabel: '언어',
  },
}
