# umuo

<div align="center">

**macOS 번역·음성 입력 도구 · 무료 오픈소스 · 내 모델 API 키 사용**

A free, open-source macOS translator: translate in place, select-to-translate, screenshot OCR and voice input — with your own API key.

macOS 14+ · Apple Silicon · Swift + SwiftUI + AppKit · Rust 공유 코어 · 순수 BYOK · MIT 오픈소스

[简体中文](README.md) · [English](README.en.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · **한국어**

[공식 웹사이트](https://umuo.app) · [다운로드(Apple Silicon)](https://umuo.app/download/macos) · [모든 버전](https://github.com/youming-ai/umuo/releases) · [기여 가이드](CONTRIBUTING.md)

[![Release](https://img.shields.io/github/v/release/youming-ai/umuo?label=release)](https://github.com/youming-ai/umuo/releases/latest)
[![CI](https://github.com/youming-ai/umuo/actions/workflows/ci.yml/badge.svg)](https://github.com/youming-ai/umuo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%2014%2B%20%C2%B7%20Apple%20Silicon-lightgrey)

</div>

---

## umuo란

umuo는 macOS 네이티브 번역·음성 입력 도구입니다. 현재 제품 범위는 다음과 같습니다.

| 핵심 기능 | 범위 | 현재 상태 |
| --- | --- | --- |
| 텍스트 번역 | 선택 번역(⌃⌃), 입력 번역(⌥⌘A), 입력란 제자리 교체(⌥⌥). 복사, 읽어 주기, 가벼운 결과 창 | 구현 완료, 실기기 검수 대기 |
| 스크린샷(OCR) 번역 | 시스템 영역 선택(⌥⌘O), Apple Vision 로컬 인식, 원문 수정 후 번역 | 구현 완료, 실기기 검수 대기 |
| 음성 입력 | ⌥⌘V를 누른 채 말하면 매끄러운 문장으로 다듬고, ⌃⌘V를 누른 채 말하면 목표 언어로 번역. Mac에서 음성 인식 후 결과를 원래 입력란에 다시 써넣음 | 구현 완료, 실기기 검수 대기 |

umuo는 완전 무료이며 MIT 라이선스로 공개된 오픈소스이고, 순수 BYOK 방식입니다. 사용자가 직접 모델 API 키를 가져와 쓰며, 모델 호출 비용은 제공업체에 직접 지불합니다. umuo는 요금을 받지 않으며 라이선스, 체험판, 구독, 공식 사용량, AI 게이트웨이가 없습니다.

모델 API 키는 시스템 키체인에 저장되며, 제공업체 요청은 Mac에서 사용자가 설정한 엔드포인트로 직접 전송됩니다. 음성은 Mac에서 transcribe.cpp + Qwen3-ASR-0.6B로 인식하므로
별도의 음성 API 키가 필요 없습니다. 다듬기와 번역은 텍스트 모델을 그대로 사용하며, 클라우드 텍스트 모델을 쓰는 경우 인식된 텍스트가 해당 제공업체로 전송됩니다.

## 다운로드와 설치

[umuo.app/download/macos](https://umuo.app/download/macos)에서 다운로드합니다(macOS 14+, Apple Silicon 전용).
이 링크는 [GitHub Releases](https://github.com/youming-ai/umuo/releases) 최신 버전의 설치 파일(`umuo-v<버전>.dmg`)로 연결됩니다. 클라이언트 변경 사항이 `main`에 병합될 때마다 새 정식 버전(Latest 표시)이 자동으로 배포되며,
설치된 앱에서는 「Settings › About」(설정 › 정보)에서 업데이트를 확인할 수 있습니다.
설치 파일은 아직 Apple 공증을 받지 않았습니다. 처음 열 때 차단되면 **시스템 설정 → 개인정보 보호 및 보안**에서 「그래도 열기」를 누르세요.
아래 「소스에서 빌드」를 따라 직접 컴파일할 수도 있습니다. Homebrew 설치는 아직 제공하지 않습니다([개발 계획](docs/IMPLEMENTATION-PLAN.md)의 「할 일」 참고).

## 현재 상태와 개발 문서

2026-11-13: 네이티브 클라이언트, Sparkle 자동 업데이트, 음성 입력(녹음, 로컬 음성 인식, 다듬기/번역, 입력란에 다시 써넣기)이 완성되었습니다.
클라이언트 변경 사항이 `main`에 병합되면 GitHub Releases에 자동으로 배포됩니다(`v0.2.<번호>`, 정식 버전, 설치 파일 `umuo-v<버전>.dmg`).
정식 패키지는 고정된 자체 서명 인증서로 서명되며 **Apple 공증을 받지 않았습니다**. Developer ID 서명과 공증에는 유료 Apple 개발자 계정이 필요해 당분간 보류합니다.
실기기 검수는 아직 남아 있습니다. 첫 버전의 범위를 좁히기 위해 다중 모델 비교, 스타일·용어 관리, 비용 예산, 즐겨찾기 등 이전 기능은 제거했습니다(이전 데이터는 보존).

아래 개발 문서는 중국어 간체로 작성되어 있습니다.

- [제품 요구사항](docs/PRD.md): 현재 기능과 사업 범위.
- [첫 버전 개발 계획](docs/IMPLEMENTATION-PLAN.md): 기능 정리, 음성, 오픈소스화, 배포의 순서와 완료 조건.
- [구현·검수 체크리스트](docs/PRD-CONFORMANCE.md): 기존 코드, 새 범위 조정, 미구현 항목과 실기기 검수.
- [Handy 음성 연구](docs/research/handy-voice-analysis.md): 소스 코드 근거와 로컬 엔진 실험 방향.
- [배포와 Sparkle 키](docs/SWIFTUI-MIGRATION.md): GitHub Releases 자동 배포, 실패 시 정리, 키 관리, 향후 공증 연동 절차.
- [실기기 점검](docs/NATIVE-WALKTHROUGH.md): 텍스트·스크린샷·음성의 실기기 검수표와 성능 측정 기준.
- [기여 가이드](CONTRIBUTING.md): 라이선스, 개발 전 유의 사항, PR 요건.
- [보안 정책](SECURITY.md): 보안 취약점을 비공개로 제보하는 방법.

공식 웹사이트 [umuo.app](https://umuo.app)(단일 페이지 홈)과 Worker는 [site/](site/)에 있으며, `main`에 병합되면 Cloudflare Workers Builds가 자동으로 배포합니다.

## 소스에서 빌드

필요 사항: Apple Silicon Mac, macOS 14+, Xcode 26(또는 macOS 26 SDK가 포함된 Command Line Tools — 플로팅 창에 Liquid Glass를 사용합니다),
[rustup](https://rustup.rs)(Rust 버전은 `rust-toolchain.toml`로 고정되며 첫 빌드 때 자동 설치), [Bun](https://bun.sh) 1.4+(`package.json`의 `packageManager` 기준).

```bash
bun install          # 저장소 도구 스크립트 의존성
cargo fetch          # Rust 의존성

bun run dev:macos    # Rust 바인딩과 SwiftUI 클라이언트를 빌드한 뒤 실행(macOS 14+, Swift 6)
# 개발용 바이너리는 기본적으로 전역 단축키를 등록하지 않음. 다른 인스턴스를 먼저 종료한 뒤 bun run dev:macos --hotkeys 사용
```

## 개발 명령

| 명령 | 역할 |
| --- | --- |
| `bun run dev:macos` | SwiftUI 클라이언트를 컴파일하고 실행 |
| `bun run build` | Rust 바인딩과 네이티브 클라이언트 컴파일 |
| `bun run bundle:macos -- --version X.Y.Z` | Apple Silicon(arm64)용 `.app` / `.dmg` / `.app.tar.gz` 생성. Sparkle 공개 키 설정 필요, 업로드하지 않음 |
| `bun run icons` | 네이티브 앱 ICNS와 메뉴 막대 PNG 직접 생성 |
| `bun run lint` / `bun run format` | 도구 스크립트 Biome 검사 / 포맷 |
| `bun run type-check` | 도구 스크립트 TypeScript 타입 검사 |
| `bun run test:rust` | Rust workspace 단위 테스트와 파이프라인 회귀 테스트 |
| `bun run verify:macos` | Swift 빌드, Swift Testing, FFI 자체 점검, 패키징 스모크 테스트 |
| `bun run verify` | 커밋 전 전체 검사. GitHub Actions의 CI와 동일 |

### 선택 번역을 쓰려면 시스템 권한이 한 번 필요합니다

앱 화면은 아직 한국어를 지원하지 않아 영어 등 다른 언어로 표시되므로, 아래 메뉴 이름은 영어로 적었습니다.

클라이언트를 실행한 뒤 먼저 **Settings → Engines**(설정 → 엔진)에서 제공업체 API 키를 하나 입력하고,
**시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용**에서 `umuo`를 켭니다(개발 모드에서는 실행 중인 터미널이나 IDE).
이 권한이 없으면 클라이언트가 선택한 텍스트를 읽을 수 없습니다. 이때는 조용히 실패하지 않고 플로팅 창이 바로 알려 줍니다.

이후 아무 앱에서나 텍스트를 선택하고 **⌃**를 두 번 연속으로 누르면(⌃⌃) 마우스 근처의 플로팅 창에 번역이 스트리밍으로 표시됩니다.

### 음성 입력

아무 입력란에서나 **⌥⌘V**를 누른 채 말하고 손을 떼면, 매끄러운 문장으로 다듬어 입력란에 다시 써넣습니다. **⌃⌘V**를 누른 채 말하면 목표 언어로 번역해서 써넣습니다.
처음 사용할 때 마이크 권한을 요청하고 Hugging Face에서 약 560MB의 음성 인식 모델을 내려받습니다. 입력란에 다시 써넣는 데에도 손쉬운 사용 권한이 필요합니다.
두 단축키 모두 **Settings → Translation → Voice Input**(설정 → 번역 → 음성 입력)에서 바꿀 수 있습니다.

## 저장소 구조

```
apps/macos/          Swift + SwiftUI + AppKit 네이티브 클라이언트(SwiftPM)
  Sources/Umuo/      App, Platform, Panel, Compose, Voice, History, Settings, Onboarding, Quick
  Tests/UmuoTests/   Swift Testing: 뷰 모델과 순수 규칙
  packaging/         Info.plist, 아이콘, 서명 권한(entitlements)
  scripts/           Rust 바인딩 빌드, 네이티브 개발, 검증, 패키징
crates/umuo-ffi/     UniFFI 내보내기와 타입 변환(앱에 링크되는 정적 라이브러리)
crates/umuo-bindgen/ Swift 바인딩을 생성하는 uniffi-bindgen(빌드 때만 사용, 배포 산출물에는 미포함)
crates/umuo-app/     공유 앱 로직: 설정, 번역 파이프라인, 음성 세션과 후처리, 기록
  tests/             로컬 SSE 파이프라인 회귀 테스트와 이벤트 호환성 스냅숏
crates/umuo-core/    플랫폼 독립 번역 코어: Provider, Prompt, 스트리밍 파싱, 계량
crates/umuo-store/   로컬 SQLite: 기록(이전 즐겨찾기·사용량 테이블은 데이터만 보존)
site/               공식 웹사이트와 Worker, 독립 Bun 프로젝트
scripts/            아이콘 생성, 서드파티 라이선스 검사, 네이티브 배포 도구
docs/              PRD, 아키텍처, 배포, 실기기 점검, 검수 체크리스트
```

## 아키텍처 원칙

1. UI는 SwiftUI를, 창과 시스템 기능은 AppKit과 Apple 네이티브 API를 사용합니다. 인터랙션은 Apple Human Interface Guidelines를 따릅니다.
2. `umuo-app`과 `umuo-core`는 플랫폼 독립적으로 유지해 Linux에서도 테스트할 수 있습니다. 앱 오케스트레이션은 UniFFI로 Swift에 제공하며 Swift에서 다시 구현하지 않습니다.
3. 플랫폼 기능은 Swift 호스트에서 구현합니다: AX 텍스트 가져오기와 다시 써넣기, 키체인, Vision OCR, 음성, 단축키, 창.
4. Provider는 데이터입니다. 요청은 스트리밍으로 출력되고 요청마다 독립적으로 취소되며, 이전 이벤트가 새 결과를 덮어쓰지 않습니다.
5. API 키는 시스템 키체인에만 저장하고 설정, 로그, 기록에는 남기지 않습니다. 제공업체 요청은 Rust에서 보냅니다.

## 개인정보

- BYOK 모드에서 요청은 사용자가 직접 설정한 엔드포인트로만 전송됩니다. umuo 서버는 사용자의 콘텐츠도, API 키도 받지 않습니다.
- 번역 기록은 Mac의 SQLite에 저장되며, 검색·삭제할 수 있고 보존 기간을 설정하거나 완전히 끌 수도 있습니다.
- 음성은 Mac에서 인식합니다. 녹음은 임시 파일에만 기록되고 인식이 끝나거나 취소되면 즉시 삭제되며, umuo에도 모델 제공업체에도 전송되지 않습니다.
- 콘텐츠 원격 측정은 기본적으로 꺼져 있습니다.

## 기여하기

Issue와 Pull Request를 환영합니다(Issue와 PR 모두 템플릿이 있습니다. **API 키는 어디에도 붙여 넣지 마세요**). 보안 취약점은 공개 Issue를 열지 말고 [SECURITY.md](SECURITY.md)에 따라 비공개로 제보해 주세요. 개발 전에 [AGENTS.md](AGENTS.md)(계층 규칙, 명령, 테스트 규약 — 사람과 agent 공용)와 [CONTRIBUTING.md](CONTRIBUTING.md)를 먼저 읽어 주세요.
커밋 전에 로컬에서 `bun run verify`를 통과시켜 주세요(공식 웹사이트를 수정했다면 `site/`에서도 `bun run verify` 실행). PR은 CI에서 한 번 더 검사합니다.

## 라이선스

[MIT](LICENSE). 저장소 전체(공식 웹사이트 `site/` 포함)에 적용됩니다. 「umuo」라는 이름과 수달 아이콘은 MIT 라이선스에 포함되지 않습니다. 수정판을 배포할 때는 다른 이름과 아이콘을 사용해 주세요. 작품이 umuo를 기반으로 한다고 밝히는 것은 제한하지 않습니다. 기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요. 참고하거나 재사용한 서드파티 구현은 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)에 기록되어 있습니다.
