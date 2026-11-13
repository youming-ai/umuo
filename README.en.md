# umuo

<div align="center">

**A free, open-source macOS translator: translate in place, select-to-translate, screenshot OCR and voice input — with your own API key.**

macOS 14+ · Apple Silicon · Swift + SwiftUI + AppKit · Shared Rust core · BYOK only · MIT licensed

[简体中文](README.md) · **English** · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

[Website](https://umuo.app) · [Download (Apple Silicon)](https://umuo.app/download/macos) · [All releases](https://github.com/youming-ai/umuo/releases) · [Contributing](CONTRIBUTING.md)

[![Release](https://img.shields.io/github/v/release/youming-ai/umuo?label=release)](https://github.com/youming-ai/umuo/releases/latest)
[![CI](https://github.com/youming-ai/umuo/actions/workflows/ci.yml/badge.svg)](https://github.com/youming-ai/umuo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%2014%2B%20%C2%B7%20Apple%20Silicon-lightgrey)

</div>

---

## What it is

umuo is a native macOS app for translation and voice input. Its current scope:

| Feature | Scope | Status |
| --- | --- | --- |
| Text translation | Selection (⌃⌃), Text Translation for typed input (⌥⌘A), Replace in Text Field (⌥⌥); copy, read aloud and a lightweight result window | Implemented, awaiting on-device acceptance testing |
| Screenshot OCR translation | System region capture (⌥⌘O), on-device recognition with Apple Vision, edit the recognized text before translating | Implemented, awaiting on-device acceptance testing |
| Voice input | Hold ⌥⌘V and speak to get clean, well-formed text; hold ⌃⌘V and speak to get it in your target language. Transcription runs on your Mac and the result is written back into the text field you were typing in | Implemented, awaiting on-device acceptance testing |

umuo is completely free and open source under the MIT license, and BYOK only: you bring your own model API key and pay the provider directly for usage. umuo charges nothing — there are no licenses, trials, subscriptions, bundled credits or AI gateway.

API keys are stored in the macOS Keychain, and provider requests go straight from your Mac to the endpoint you configured. Speech is transcribed on your Mac with transcribe.cpp + Qwen3-ASR-0.6B,
so no separate speech API key is needed. Cleanup and translation reuse your text model; if that is a cloud model, the transcribed text is sent to that provider.

## Download and install

Download from [umuo.app/download/macos](https://umuo.app/download/macos) (macOS 14+, Apple Silicon only).
It redirects to the installer for the latest version on [GitHub Releases](https://github.com/youming-ai/umuo/releases) (`umuo-v<version>.dmg`). Every client change merged into `main` automatically publishes a new stable release (marked Latest),
and an installed app can check for updates under **Settings › About**.
The installer is not yet notarized by Apple: if macOS blocks it on first launch, go to **System Settings → Privacy & Security** and click **Open Anyway**.
You can also build it yourself — see "Build from source" below. Homebrew installation is not available yet (see "To do" in the [implementation plan](docs/IMPLEMENTATION-PLAN.md)).

## Current status and where to start

2026-11-13: The native client, Sparkle auto-updates and voice input (recording, on-device transcription, cleanup/translation, writing back into the text field) are complete.
Client changes merged into `main` are published to GitHub Releases automatically (`v0.2.<build number>`, stable release, installer `umuo-v<version>.dmg`).
Release builds are signed with a fixed self-signed certificate and are **not notarized by Apple**; Developer ID signing and notarization require a paid Apple Developer account and are on hold for now.
On-device acceptance testing is still to be done. To keep the first release focused, older features — multi-model comparison, style and glossary management, cost budgets and favorites — have been removed (existing data is kept).

Project docs (developer docs are in Simplified Chinese):

- [Product requirements](docs/PRD.md): current features and business boundaries.
- [First-release plan](docs/IMPLEMENTATION-PLAN.md): order and completion criteria for slimming down, voice, open-sourcing and release.
- [Implementation and acceptance checklist](docs/PRD-CONFORMANCE.md): existing code, scope changes, what is not implemented, and on-device acceptance.
- [Releases and Sparkle keys](docs/SWIFTUI-MIGRATION.md): automatic GitHub Releases publishing, cleanup after failures, keys, and the steps for adding notarization later.
- [On-device walkthrough](docs/NATIVE-WALKTHROUGH.md): on-device acceptance sheets for text, screenshot and voice, plus how performance is measured.
- [Contributing guide](CONTRIBUTING.md): licensing, what to know before you start, and PR requirements.
- [Security policy](SECURITY.md): how to report a security vulnerability privately.

The website [umuo.app](https://umuo.app) (a single landing page) and its Worker live in [site/](site/), and are deployed automatically by Cloudflare Workers Builds once merged into `main`.

## Build from source

Requirements: an Apple Silicon Mac running macOS 14+; Xcode 26 (or Command Line Tools with the macOS 26 SDK — the floating panel uses Liquid Glass);
[rustup](https://rustup.rs) (the Rust version is pinned by `rust-toolchain.toml` and installed automatically on the first build); and [Bun](https://bun.sh) 1.4+ (the `packageManager` field in `package.json` is authoritative).

```bash
bun install          # dependencies for the repo's tooling scripts
cargo fetch          # Rust dependencies

bun run dev:macos    # build the Rust bindings and the SwiftUI client, then launch (macOS 14+, Swift 6)
# Dev builds don't register global shortcuts by default; quit other instances first, then run bun run dev:macos --hotkeys
```

## Development commands

| Command | What it does |
| --- | --- |
| `bun run dev:macos` | Build and launch the SwiftUI client |
| `bun run build` | Build the Rust bindings and the native client |
| `bun run bundle:macos -- --version X.Y.Z` | Produce the Apple Silicon (arm64) `.app` / `.dmg` / `.app.tar.gz`; requires the Sparkle public key; does not upload |
| `bun run icons` | Generate the native app ICNS and menu bar PNGs |
| `bun run lint` / `bun run format` | Biome lint / format for the tooling scripts |
| `bun run type-check` | TypeScript type check for the tooling scripts |
| `bun run test:rust` | Rust workspace unit tests and pipeline regression tests |
| `bun run verify:macos` | Swift build, Swift Testing, FFI self-check and packaging smoke test |
| `bun run verify` | Full pre-commit gate, matching CI on GitHub Actions |

### Selection translation needs one system permission

After launching the client, first enter an API key for a provider under **Settings → Engines**, then go to
**System Settings → Privacy & Security → Accessibility** and enable `umuo` (in development, enable the terminal or IDE you run it from).
Without this permission the client can't read the text you've selected — and the floating panel tells you so instead of failing silently.

Then select text in any app and tap **⌃** twice (⌃⌃): the translation streams into a floating panel next to your pointer.

### Voice input

In any text field, hold **⌥⌘V** and speak; when you release, your words are cleaned up into well-formed text and written back into the field. Hold **⌃⌘V** instead to have them translated into your target language before they are written back.
The first use asks for microphone permission and downloads a transcription model of about 560 MB from Hugging Face; writing back into the text field also needs Accessibility permission.
Both shortcuts can be changed under **Settings → Translation → Voice Input**.

## Repository layout

```
apps/macos/          Swift + SwiftUI + AppKit native client (SwiftPM)
  Sources/Umuo/      App, Platform, Panel, Compose, Voice, History, Settings, Onboarding, Quick
  Tests/UmuoTests/   Swift Testing: view models and pure rules
  packaging/         Info.plist, icons and signing entitlements
  scripts/           Rust binding build, native dev, verification and packaging
crates/umuo-ffi/     UniFFI exports and type conversion (static library linked into the app)
crates/umuo-bindgen/ uniffi-bindgen that generates the Swift bindings (build-time only, not shipped)
crates/umuo-app/     Shared app logic: settings, translation pipeline, voice sessions and post-processing, history
  tests/             Local SSE pipeline regression tests and event-compatibility snapshots
crates/umuo-core/    Platform-independent translation core: providers, prompts, stream parsing, metering
crates/umuo-store/   Local SQLite: history (legacy favorites and usage tables kept for data only)
site/               Website and Worker, a standalone Bun project
scripts/            Icon generation, third-party license checks and native release tooling
docs/              PRD, architecture, releases, on-device walkthrough and acceptance checklists
```

## Architecture principles

1. The UI is built with SwiftUI; windows and system integration use AppKit and native Apple APIs. Interaction design follows Apple's Human Interface Guidelines.
2. `umuo-app` and `umuo-core` stay platform-independent and testable on Linux; app orchestration is exposed to Swift via UniFFI rather than rewritten in Swift.
3. Platform capabilities are implemented in the Swift host: reading and writing text via Accessibility (AX), Keychain, Vision OCR, voice, shortcuts and windows.
4. Providers are data; requests stream their output, each request can be cancelled independently, and stale events never overwrite newer results.
5. Keys live only in the macOS Keychain — never in config, logs or history — and provider requests are made from Rust.

## Privacy

- With BYOK, requests go only to the endpoints you configure; umuo's servers never see your content or your keys.
- Translation history is stored locally in SQLite. You can search and delete it, set how many days to keep it, or turn it off entirely.
- Speech is transcribed on your Mac: audio is written only to a temporary file that is deleted as soon as transcription finishes or is cancelled, and it is never sent to umuo or to the model provider.
- Content telemetry is off by default.

## Contributing

Issues and pull requests are welcome (both have templates; **never paste your API key anywhere**). Please report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md) rather than opening a public issue. Before you start, read [AGENTS.md](AGENTS.md) (layering rules, commands and testing conventions, shared by humans and agents) and [CONTRIBUTING.md](CONTRIBUTING.md);
run `bun run verify` locally before submitting (and also `bun run verify` in `site/` if you changed the website). CI runs it again on your PR.

## License

[MIT](LICENSE), covering the whole repository (including the website in `site/`). The "umuo" name and the otter icon are not licensed under MIT: if you distribute a modified version, please use a different name and icon; you are free to say your work is based on umuo. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute. Third-party implementations we referenced or reused are listed in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
