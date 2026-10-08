import type { SiteContent } from './types'

/** 한국어 문안. 구조와 제품 정보는 en.ts를 기준으로 합니다. */
export const ko: SiteContent = {
  locale: 'ko',
  seo: {
    title: 'umuo: 내 API 키로 사용하는 Mac AI 번역기 (BYOK)',
    description:
      'macOS 어디서나 AI 번역: ⌥D 선택 영역 번역, ⌥A 글쓰기 창, ⌥⇧T 제자리 텍스트 교체, ⌥S 스크린샷 OCR. 내 API 키를 사용하고 로컬 키체인에 안전하게 보관하세요.',
    ogLocale: 'ko_KR',
  },
  nav: {
    skipToContent: '본문으로 바로가기',
    mainNavLabel: '주 메뉴',
    links: [
      { kind: 'product', label: '제품' },
      { kind: 'pricing', label: '요금' },
    ],
    download: '다운로드',
    menuOpen: '메뉴 열기',
    menuClose: '메뉴 닫기',
    languageLabel: '언어',
    themeLabel: '테마',
    themeToLight: '라이트 테마로 전환',
    themeToDark: '다크 테마로 전환',
  },
  hero: {
    badge: 'macOS용 V1.0 개발 중',
    title: '나의 AI로, 어디서나 번역.',
    subtitle: '텍스트를 선택하고 단축키를 누르세요. 하던 일을 그대로 이어가세요.',
    facts: ['계정 없이 사용', 'API 키는 시스템 키체인에 보관', '요청은 제공업체로 직접 전송'],
    demo: {
      label: '번역 미리보기',
      language: '영어',
      translation: '날쌘 갈색 여우가 게으른 개를 뛰어넘습니다.',
      metrics: 'gpt-4o-mini로 번역, 첫 단어까지 380 ms',
    },
    platformsLabel: '다운로드',
    platforms: [
      {
        id: 'macos',
        name: 'macOS',
        requirement: 'macOS 13 이상, Apple Silicon 또는 Intel',
        actionLabel: 'macOS용 다운로드',
        statusLabel: 'V1.0 개발 중',
        note: '아직 설치 파일이 출시되지 않았습니다. 이메일을 남겨 주시면 출시 당일 알려 드립니다.',
      },
    ],
    notify: {
      title: '출시 알림',
      description:
        '출시 시 이메일 한 통만 보내 드립니다. 이메일 주소는 이 알림을 위해서만 보관합니다.',
      emailLabel: '이메일',
      emailPlaceholder: 'you@example.com',
      submit: '출시 알림 받기',
      cancel: '취소',
      hint: '저장했습니다. 출시 시 이메일을 한 번 보내 드립니다. 언제든 삭제를 요청하실 수 있습니다.',
      error: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    },
  },
  shortcuts: {
    label: '단축키',
    title: '단축키 하나로, 흐름은 끊김 없이.',
    description: '텍스트를 선택하고, 작성하고, 교체하거나 캡처하세요.',
    items: [
      {
        keys: ['⌥', 'D'],
        name: '선택 영역 번역',
        description: '텍스트를 선택하면 패널에서 번역을 읽을 수 있습니다.',
      },
      {
        keys: ['⌥', 'A'],
        name: '글쓰기 창',
        description: '내 언어로 작성하면 자동으로 번역됩니다.',
      },
      {
        keys: ['⌥', '⇧', 'T'],
        name: '제자리 텍스트 교체',
        description: '입력한 텍스트를 번역해 교체합니다. 언제든 실행 취소할 수 있습니다.',
      },
      {
        keys: ['⌥', 'S'],
        name: '스크린샷 OCR',
        description: '영역을 캡처하면 기기에서 텍스트를 인식한 뒤 번역합니다.',
      },
    ],
    extraTitle: '그 밖의 기본 단축키',
    extra: [
      {
        keys: ['⌥', 'C'],
        name: '조용한 OCR (원문 텍스트만 복사)',
      },
      {
        keys: ['⌥', '⇧', 'C'],
        name: '모델 비교 (최대 네 개를 나란히 비교)',
      },
      {
        keys: ['⌥', 'R'],
        name: '선택 영역 소리 내어 읽기',
      },
      {
        keys: ['오른쪽 ⌥ 길게 누르기'],
        name: '음성 입력 (V1.1)',
      },
    ],
    extraNote: '단축키를 자유롭게 설정하고 충돌 여부를 자동으로 확인하세요.',
  },
  logoWall: {
    label: '모델',
    title: '원하는 모델을 선택하세요',
    description: '주요 AI 제공업체, 사용자 지정 엔드포인트, 로컬 모델을 사용할 수 있습니다.',
    providers: [
      'OpenAI',
      'Anthropic',
      'Google Gemini',
      'DeepSeek',
      'Qwen',
      'Zhipu GLM',
      'Moonshot',
      'OpenRouter',
      'Ollama',
      'LM Studio',
      '사용자 지정 엔드포인트',
    ],
    footnote: 'OpenAI 호환. Ollama / LM Studio를 자동으로 감지합니다.',
  },
  pillars: [
    {
      id: 'read',
      label: '읽기',
      title: '선택하고 번역하세요',
      description: '브라우저, 문서, 채팅에서 번역을 읽으세요.',
      items: [
        {
          title: '선택 영역이나 문장 번역',
          description:
            '먼저 손쉬운 사용 API로 선택한 텍스트를 읽습니다. 실패하면 umuo가 ⌘C를 실행해 읽고, 작업이 끝나면 클립보드를 원래대로 복원합니다.',
        },
        {
          title: '단어 카드',
          description:
            '세 단어 이하를 선택하면 발음 기호, 품사, 뜻, 활용형, 예문 두 개, 재생 버튼이 담긴 체계적인 카드를 보여 줍니다.',
        },
        {
          title: '모델 비교',
          description:
            '같은 글을 설정된 모델 최대 네 개에 동시에 보내고 응답 시간과 토큰 수를 나란히 비교하세요. 가장 좋은 결과를 선택하면 그 선호도가 로컬 통계에 반영되어 기본 모델을 추천하는 데 쓰입니다.',
        },
        {
          title: '문장별 대조 보기',
          description:
            '긴 글을 문장 단위로 나눠 원문과 번역을 나란히 보여 줍니다. 위아래로 오가며 스크롤하지 않아도 번역을 확인할 수 있습니다.',
          tag: 'V1.1',
        },
      ],
      footnote:
        '출시 검증 기준: Safari, Chrome, VS Code, Slack, WeChat, Feishu, Notion, 미리보기에서 선택한 텍스트 읽기 성공률 95% 이상.',
    },
    {
      id: 'write',
      label: '쓰기',
      title: '내 언어로 작성하세요',
      description: '작성한 글을 그 자리에서 원하는 언어로 바꾸세요.',
      items: [
        {
          title: '글쓰기 창',
          description:
            '위에는 입력문, 아래에는 번역문이 표시되며 원문 언어, 번역 언어, 모델, 문체를 선택할 수 있습니다. 역번역으로 결과를 내 언어로 다시 확인하고, 보내기 전에 어조를 점검하세요.',
        },
        {
          title: '제자리 텍스트 교체',
          description:
            '현재 선택한 텍스트를 읽고 번역해 그 자리에 넣습니다. 선택한 텍스트가 없으면 입력란 전체를 처리합니다. 처리 중에는 커서 옆에 작은 로딩 표시가 나타납니다. 실패하면 원문을 그대로 유지하고 알림으로 이유를 알려 줍니다.',
        },
        {
          title: '문체와 프롬프트 프리셋',
          description:
            '표준, 일상, 격식 있는 비즈니스, 학술, 기술 문체의 프리셋을 제공합니다. 코드와 고유명사는 유지하며, {source_lang}, {text}, {glossary}, {app_name} 변수를 활용해 나만의 시스템 프롬프트도 만들 수 있습니다.',
        },
        {
          title: '문장 다듬기와 교정',
          description:
            '문법을 고치고 어조를 바꾸거나, 장황한 문단을 명확하고 짜임새 있는 글로 다듬습니다.',
          tag: 'V1.1',
        },
      ],
      footnote:
        '번역 언어를 고정하거나 앱별로 기억하게 하세요. Slack에서 영어를 한 번 선택하면 이후에도 Slack에서는 영어를 사용합니다.',
    },
    {
      id: 'look',
      label: '보기',
      title: '화면 속 글자를 번역하세요',
      description: '자막, 스캔 문서, 이미지에서 텍스트를 추출하세요.',
      items: [
        {
          title: '스크린샷 OCR',
          description:
            '⌥S를 누르면 십자선과 돋보기가 있는 영역 선택 모드로 들어갑니다. 인식한 텍스트를 원문으로 삼아 바로 번역합니다. 텍스트 인식은 Mac에서 실행되며 스크린샷은 업로드되지 않습니다.',
        },
        {
          title: '조용한 OCR',
          description:
            '⌥C로 텍스트를 인식해 복사합니다. 번역 창은 열리지 않습니다. 이미지에서 글자만 추출하고 싶을 때 사용하세요.',
        },
        {
          title: '멀티모달 이미지 번역',
          description:
            '기본 OCR 엔진은 무료로 기기에서 실행되는 Apple Vision입니다. 만화, 포스터, 복잡한 레이아웃에는 이미지를 직접 읽는 멀티모달 모델로 전환할 수 있습니다.',
          tag: 'V1.1',
        },
        {
          title: '오버레이 모드',
          description:
            '스크린샷의 원문 위치 위에 번역을 덧입힙니다. 만화와 설명서를 가장 직관적으로 읽을 수 있는 방식입니다.',
          tag: 'V1.1',
        },
        {
          title: '음성 입력과 음성 번역',
          description:
            '오른쪽 ⌥를 누른 채 말하고 손을 떼면 텍스트가 나타납니다. 내 언어로 받아쓰거나 말한 내용을 원하는 언어로 번역하세요. 기본 제공 음성 사용량, 내 API 키 또는 로컬 Whisper로 음성을 텍스트로 변환할 수 있습니다.',
          tag: 'V1.1',
        },
      ],
      footnote:
        '화면 기록 권한은 처음 스크린샷을 찍을 때 요청합니다. 이 기능을 사용하지 않으면 권한을 요청하지 않습니다.',
    },
  ],
  byok: {
    label: 'BYOK',
    title: '내 API 키, 내 데이터.',
    description: 'API 키는 내 기기에 보관됩니다. BYOK 요청은 모델로 직접 전송됩니다.',
    points: [
      {
        title: 'API 키는 로컬 키체인에 보관',
        description: 'API 키는 키체인에만 보관하며 설정 파일이나 로그에 남기지 않습니다.',
      },
      {
        title: '요청은 제공업체로 직접 전송',
        description: 'BYOK는 직접 연결합니다. 기본 제공 사용량은 umuo 게이트웨이를 거칩니다.',
      },
      {
        title: '로컬 모델은 오프라인에서도 사용',
        description: '콘텐츠를 기기 밖으로 보내지 않고 Ollama / LM Studio를 사용하세요.',
      },
    ],
    flowTitle: '세 단계로 번역하세요',
    flow: ['텍스트를 선택하고 ⌥D 누르기', '내 모델에 연결', '번역 읽기'],
    costTitle: '사용한 만큼만 지불하세요',
    costRows: [
      {
        label: '번역 한 번',
        value: '약 750 토큰',
      },
      {
        label: '경량 모델',
        value: '100만 토큰당 약 $0.62',
      },
      {
        label: '실제 사용 비용',
        value: '번역 1,000회에 약 $0.50',
      },
    ],
    costNote:
      '요금은 제공업체에 직접 지불합니다. gpt-4o-mini의 공시 가격(100만 토큰당 $0.15 / $0.60)을 기준으로,' +
      ' 문장 1,000개를 번역하면(문장당 입력 약 40 토큰 + 출력 60 토큰) 약 $0.04가 듭니다. 더 강력한 모델은 비용이 상당히 높아집니다.',
  },
  features: {
    label: '더 보기',
    title: '작지만 유용한 기능',
    description: 'V1.0에 포함할 예정입니다. 버전 표시가 있는 기능은 이후 버전에서 제공됩니다.',
    items: [
      {
        title: '번역 문체',
        description: '일상, 비즈니스, 학술 문체나 나만의 프롬프트를 사용하세요.',
      },
      {
        title: '사용자 지정 단축키',
        description: '원하는 단축키를 등록하고 충돌 여부를 확인하세요.',
      },
      {
        title: '로컬 기록',
        description: '번역 기록을 검색하세요. 개인정보 보호 모드에서는 기록을 남기지 않습니다.',
      },
      {
        title: '즐겨찾기',
        description: '나중에 다시 볼 번역을 저장하세요.',
      },
      {
        title: '사용량 추적',
        description: '토큰과 비용을 확인하고 월별 한도를 설정하세요.',
      },
      {
        title: '소리 내어 읽기',
        description: '텍스트를 듣고 발음을 확인하세요.',
      },
      {
        title: 'API 키 없이도 사용',
        description: 'API 키 없이 웹 번역을 사용하세요.',
      },
      {
        title: '기본 제공 AI 사용량',
        description: '로그인하고 남은 사용량을 확인하세요.',
      },
    ],
  },
  comparison: {
    label: '비교',
    title: '한눈에 비교하세요',
    description: '지원 플랫폼, 모델, 요금을 나란히 비교하세요.',
    columns: ['', 'umuo', 'DeepL Desktop', 'Bob', 'Trancy Air'],
    rows: [
      {
        label: '플랫폼',
        values: ['macOS 13+', 'macOS, Windows', 'macOS', 'macOS, Windows'],
      },
      {
        label: '내 API 키와 로컬 모델',
        values: [
          '키체인에 API 키 보관, 오프라인 로컬 모델',
          '모델 변경 불가',
          '타사 플러그인에 따라 지원',
          '사용자 지정 엔진은 계정이 필요하며 해당 서비스의 클라우드를 통해 동기화',
        ],
      },
      {
        label: '요금',
        values: [
          'BYOK 무료, 기본 제공 사용량은 월 $5.99부터',
          '무료 요금제와 구독',
          '일부 기능은 일회성 구매',
          '구독, 지역별 요금 적용',
        ],
      },
    ],
    footnote: '최신 정보는 각 제공업체의 웹사이트에서 확인하세요.',
  },
  pricing: {
    label: '요금',
    title: '간단한 요금, 선택은 자유롭게.',
    description:
      '클라이언트는 무료로 다운로드할 수 있습니다. BYOK는 무제한입니다. 기본 제공 AI 사용량이 필요하면 구독하세요.',
    billingLabel: '결제 주기',
    monthly: '월간',
    yearly: '연간',
    yearlyBadge: '약 35% 할인',
    recommended: '추천',
    tiers: [
      {
        id: 'free',
        name: '무료 계정',
        tagline: '가볍게 시작하세요',
        priceMonthly: '$0',
        priceYearly: '$0',
        periodMonthly: '계속 무료',
        periodYearly: '계속 무료',
        requirement: '계정 필요',
        features: [
          '월 300K 고속 토큰',
          '월 30분 음성 사용 (V1.1)',
          '설정 동기화 (V1.1, API 키 제외)',
          'BYOK, 로컬 모델, 웹 번역 무제한',
        ],
        cta: '계정 만들기',
      },
      {
        id: 'pro',
        name: 'Pro',
        tagline: '일상 업무에 충분하게',
        priceMonthly: '$5.99',
        priceYearly: '$46.99',
        periodMonthly: '/ 월',
        periodYearly: '/ 년',
        requirement: '계정 필요',
        features: [
          '월 3M 고속 토큰',
          '월 300분 음성 사용 (V1.1)',
          '무료 계정 사용량 포함',
          '월간 1일 / 연간 3일 체험, 무료 취소',
        ],
        cta: 'Pro로 업그레이드',
        highlight: true,
      },
      {
        id: 'pro-plus',
        name: 'Pro + 고급 AI',
        tagline: '더 높은 품질로',
        priceMonthly: '$11.99',
        priceYearly: '$93.99',
        periodMonthly: '/ 월',
        periodYearly: '/ 년',
        requirement: '계정 필요',
        features: [
          'Pro 사용량 포함',
          '더 높은 품질의 모델',
          '월 10M 고급 토큰',
          '월 600분 음성 사용 (V1.1)',
        ],
        cta: 'Pro + 고급 AI로 업그레이드',
      },
    ],
    openSource: {
      title: 'BYOK는 언제나 무료',
      description: '클라이언트의 모든 기능은 무료입니다. BYOK는 계정 없이 사용할 수 있습니다.',
    },
    addon: {
      title: '추가 충전, $3.99',
      description: '고급 토큰 +5M 또는 음성 사용 +300분, 현재 이용 기간 내 유효.',
    },
    regionalNote:
      '중국 본토에서는 WeChat으로 결제합니다. Pro는 월 ¥28 또는 연 ¥218, Pro + 고급 AI는 월 ¥58 또는 연 ¥448입니다. 그 외 지역에서는 현지 통화로 반올림한 가격이 적용됩니다.',
    refundNote:
      '월간 요금제는 7일 이내, 연간 요금제는 30일 이내에 사유를 묻지 않고 환불해 드립니다. 고급 사용량이 포함된 요금제는 이미 사용한 만큼의 금액을 차감하고 환불합니다.',
    footnote: '연간 결제 시 약 35% 할인됩니다. 베타 기간의 제공 사용량은 변경될 수 있습니다.',
  },
  faq: {
    label: '자주 묻는 질문',
    title: '궁금한 점을 확인하세요',
    description: '사용 방법, 개인정보 보호, 구독 안내.',
    items: [
      {
        question: 'BYOK란 무엇인가요?',
        answer:
          '내 API 키를 가져와 사용하는 방식입니다. umuo 계정은 필요하지 않습니다. 모델 제공업체에 직접 요금을 지불하거나 무료 로컬 모델을 사용할 수 있습니다.',
      },
      {
        question: '요금제는 어떻게 다른가요?',
        answer:
          '클라이언트 기능은 무료입니다. 구독하면 AI 사용량이 추가됩니다. 사용량을 다 쓰면 추가 충전하거나 BYOK로 전환할 수 있습니다. 월간 요금제는 7일, 연간 요금제는 30일 이내 환불 가능하며, 이미 사용한 고급 사용량의 금액은 차감됩니다.',
      },
      {
        question: 'API 키나 콘텐츠가 업로드되나요?',
        answer:
          'BYOK의 API 키는 내 기기에 보관되며 요청은 설정한 엔드포인트로 직접 전송됩니다. 기본 제공 사용량은 umuo 게이트웨이를 이용하며, 게이트웨이는 번역 내용을 저장하지 않습니다.',
      },
      {
        question: '시스템 권한은 왜 필요한가요?',
        answer:
          '손쉬운 사용 권한은 텍스트를 읽고 교체하는 데, 화면 기록 권한은 선택한 영역을 캡처하는 데 필요합니다. 권한은 필요한 시점에 요청합니다.',
      },
      {
        question: 'API 키 없이도 사용할 수 있나요?',
        answer:
          '네. 웹 번역이나 로컬 모델을 사용하거나, 로그인해 기본 제공 AI 사용량을 이용할 수 있습니다.',
      },
      {
        question: '어떤 시스템을 지원하나요?',
        answer: '현재 Apple Silicon과 Intel 기반의 macOS 13 이상만 지원합니다.',
      },
      {
        question: '중국 본토에서는 어떻게 사용하나요?',
        answer:
          '시스템 프록시, HTTP 또는 SOCKS5 프록시를 사용하거나, 현지에서 이용 가능한 제공업체 또는 오프라인 모델을 사용하세요.',
      },
    ],
  },
  footer: {
    ctaTitle: '하던 일의 흐름 속에서 번역하세요',
    ctaDescription: 'macOS 버전을 개발 중입니다. 출시 알림을 받아 보세요.',
    ctaDownload: 'macOS용 다운로드',
    ctaNotify: '출시 알림 받기',
    columns: [
      {
        title: '제품',
        links: [
          {
            kind: 'features',
            label: '기능',
          },
          {
            kind: 'pricing',
            label: '요금',
          },
          {
            kind: 'comparison',
            label: '비교',
          },
          {
            kind: 'faq',
            label: '자주 묻는 질문',
          },
          {
            kind: 'top',
            label: '맨 위로',
          },
        ],
      },
      {
        title: '법적 고지 및 문의',
        links: [
          {
            kind: 'privacy',
            label: '개인정보 처리방침',
          },
          {
            kind: 'terms',
            label: '서비스 이용약관',
          },
          {
            kind: 'contact',
            label: '이메일 문의',
          },
        ],
      },
    ],
    comingSoon: '곧 공개됩니다',
    legalNote: '개인정보 처리방침과 이용약관은 출시 전에 공개됩니다.',
    copyright: '© 2026 umuo',
    languageLabel: '언어',
  },
}
