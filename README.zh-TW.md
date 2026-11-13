# umuo

<div align="center">

**macOS 翻譯與語音表達工具 · 免費開源 · 自備模型金鑰**

A free, open-source macOS translator: translate in place, select-to-translate, screenshot OCR and voice input — with your own API key.

macOS 14+ · Apple Silicon · Swift + SwiftUI + AppKit · Rust 共用核心 · 純 BYOK · MIT 開源

[简体中文](README.md) · [English](README.en.md) · **繁體中文** · [日本語](README.ja.md) · [한국어](README.ko.md)

[官網](https://umuo.app) · [下載（Apple Silicon）](https://umuo.app/download/macos) · [所有版本](https://github.com/youming-ai/umuo/releases) · [貢獻指南](CONTRIBUTING.md)

[![Release](https://img.shields.io/github/v/release/youming-ai/umuo?label=release)](https://github.com/youming-ai/umuo/releases/latest)
[![CI](https://github.com/youming-ai/umuo/actions/workflows/ci.yml/badge.svg)](https://github.com/youming-ai/umuo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%2014%2B%20%C2%B7%20Apple%20Silicon-lightgrey)

</div>

---

## 這是什麼

umuo 是 macOS 原生的翻譯與語音表達工具，目前的產品範圍如下：

| 核心 | 範圍 | 目前狀態 |
| --- | --- | --- |
| 文字翻譯 | 劃詞（⌃⌃）、輸入翻譯（⌥⌘A）、輸入框原地替換（⌥⌥）；複製、朗讀與輕量結果視窗 | 已實作，待實機驗收 |
| OCR 截圖翻譯 | 系統框選（⌥⌘O）、Apple Vision 本機辨識、修正原文後再翻譯 | 已實作，待實機驗收 |
| 語音表達 | 按住 ⌥⌘V 說話，整理成通順的文字；按住 ⌃⌘V 說話，翻譯成目標語言；本機轉寫，結果寫回原本的輸入框 | 已實作，待實機驗收 |

umuo 完全免費、以 MIT 授權條款開源，純 BYOK：使用者自備模型金鑰，模型呼叫的費用直接付給供應商；umuo 本身不收費，沒有授權、試用、訂閱、官方額度，也沒有 AI 閘道。

模型金鑰存放在系統鑰匙圈，對供應商的請求從本機直接連到使用者設定的端點。語音在本機以 transcribe.cpp + Qwen3-ASR-0.6B 轉寫，
不需要額外的語音金鑰；整理與翻譯沿用文字模型，若使用雲端文字模型，轉寫出的文字會傳送給該供應商。

## 下載與安裝

從 [umuo.app/download/macos](https://umuo.app/download/macos) 下載（macOS 14+，僅支援 Apple Silicon），
它會導向 [GitHub Releases](https://github.com/youming-ai/umuo/releases) 最新版的安裝檔（`umuo-v<版本>.dmg`）；每次用戶端的變更合併進 `main`，都會自動發布一個新的正式版（標記為 Latest），
已安裝的 App 可以在「設定 › 關於」裡檢查更新。
安裝檔尚未經 Apple 公證：首次打開若被攔下，請到**系統設定 → 隱私權與安全性**點「仍要打開」。
也可以依照下方「從原始碼建置」自行編譯。目前暫不提供 Homebrew 安裝（見 [開發計畫](docs/IMPLEMENTATION-PLAN.md)「待辦」）。

## 目前狀態與開發入口

2026-11-13：原生用戶端、Sparkle 自動更新與語音輸入（錄音、本機轉寫、整理／翻譯、寫回輸入框）皆已完成，
用戶端的變更合併進 `main` 後即自動發布到 GitHub Releases（`v0.2.<序號>`，正式版，安裝檔為 `umuo-v<版本>.dmg`）。
正式版以固定的自簽憑證簽署、**未經 Apple 公證**；Developer ID 簽署與公證需要付費的 Apple 開發者帳號，目前暫緩。
實機驗收尚待進行。為了收斂首版範圍，多模型比較、風格與術語管理、費用預算、收藏等舊功能已移除（舊資料仍保留）。

以下開發文件皆為簡體中文：

- [產品需求](docs/PRD.md)：目前的功能與商業邊界。
- [首版開發計畫](docs/IMPLEMENTATION-PLAN.md)：精簡、語音、開源與發布的順序及完成條件。
- [實作與驗收清單](docs/PRD-CONFORMANCE.md)：既有程式碼、新的範圍調整、尚未實作項目與實機驗收。
- [發布與 Sparkle 金鑰](docs/SWIFTUI-MIGRATION.md)：GitHub Releases 自動發版、失敗後的清理、金鑰，以及日後接上公證的步驟。
- [實機走查](docs/NATIVE-WALKTHROUGH.md)：文字、截圖、語音的實機驗收表與效能量測口徑。
- [貢獻指南](CONTRIBUTING.md)：授權、開發前須知與 PR 要求。
- [安全性政策](SECURITY.md)：如何私下回報安全性漏洞。

官網 [umuo.app](https://umuo.app)（單頁首頁）與 Worker 位於 [site/](site/)，合併進 `main` 後由 Cloudflare Workers Builds 自動部署。

## 從原始碼建置

需求：Apple Silicon Mac、macOS 14+；Xcode 26（或附 macOS 26 SDK 的 Command Line Tools，浮動視窗用到了 Liquid Glass）、
[rustup](https://rustup.rs)（Rust 版本由 `rust-toolchain.toml` 固定，首次建置時會自動安裝）、[Bun](https://bun.sh) 1.4+（以 `package.json` 的 `packageManager` 為準）。

```bash
bun install          # 仓库工具脚本依赖
cargo fetch          # Rust 依赖

bun run dev:macos    # 编 Rust 绑定与 SwiftUI 客户端后启动（macOS 14+，Swift 6）
# 开发二进制默认不注册全局快捷键；先退出其他实例，再用 bun run dev:macos --hotkeys
```

## 開發指令

| 指令 | 作用 |
| --- | --- |
| `bun run dev:macos` | 編譯並啟動 SwiftUI 用戶端 |
| `bun run build` | 編譯 Rust 綁定與原生用戶端 |
| `bun run bundle:macos -- --version X.Y.Z` | 產生 Apple Silicon（arm64）的 `.app` / `.dmg` / `.app.tar.gz`，須設定 Sparkle 公鑰，不會上傳 |
| `bun run icons` | 直接產生原生 App 的 ICNS 與選單列 PNG |
| `bun run lint` / `bun run format` | Biome 檢查／格式化工具腳本 |
| `bun run type-check` | 工具腳本的 TypeScript 型別檢查 |
| `bun run test:rust` | Rust workspace 單元測試與流水線回歸測試 |
| `bun run verify:macos` | Swift 建置、Swift Testing、FFI 自我檢查與打包冒煙測試 |
| `bun run verify` | 提交前的完整關卡，與 GitHub Actions 的 CI 一致 |

### 要讓劃詞翻譯跑起來，需要一次系統授權

啟動用戶端後，先到**設定 → 引擎**填入一個供應商的 API Key，再到
**系統設定 → 隱私權與安全性 → 輔助使用**勾選 `umuo`（開發模式下則是執行它的終端機或 IDE）。
沒有這項權限，用戶端就讀不到你選取的文字——浮動視窗會直接告訴你這件事，而不是默默失敗。

之後在任何 App 裡選取文字、連按兩下 **⌃**（⌃⌃），譯文就會以串流方式出現在滑鼠游標附近的浮動視窗裡。

### 語音輸入

在任何輸入框裡按住 **⌥⌘V** 說話，放開後會整理成通順的文字並寫回輸入框；按住 **⌃⌘V** 則會翻譯成目標語言後再寫回。
第一次使用時會請求麥克風權限，並從 Hugging Face 下載約 560 MB 的轉寫模型；寫回輸入框同樣需要輔助使用權限。
這兩組快速鍵都可以在**設定 → 翻譯 → 語音輸入**裡修改。

## 儲存庫結構

```
apps/macos/          Swift + SwiftUI + AppKit 原生客户端（SwiftPM）
  Sources/Umuo/      App、Platform、Panel、Compose、Voice、History、Settings、Onboarding、Quick
  Tests/UmuoTests/   Swift Testing：视图模型与纯规则
  packaging/         Info.plist、图标与签名权限
  scripts/           Rust 绑定构建、原生开发、验证与打包
crates/umuo-ffi/     UniFFI 导出与类型转换（链接进 App 的静态库）
crates/umuo-bindgen/ 生成 Swift 绑定的 uniffi-bindgen（只在构建时用，不进发布产物）
crates/umuo-app/     共享应用逻辑：设置、翻译流水线、语音会话与后处理、历史
  tests/             本地 SSE 流水线回归与事件兼容快照
crates/umuo-core/    平台无关翻译内核：Provider、Prompt、流式解析、计量
crates/umuo-store/   本地 SQLite：历史（旧收藏与用量表只保留数据）
site/               官网与 Worker，独立 Bun 项目
scripts/            图标生成、第三方许可核查与原生发布工具
docs/              PRD、架构、发布、真机走查与验收清单
```

## 架構原則

1. UI 使用 SwiftUI，視窗與系統功能使用 AppKit 與 Apple 原生 API；互動以 Apple Human Interface Guidelines 為依據。
2. `umuo-app` 與 `umuo-core` 保持與平台無關，可在 Linux 上測試；應用程式的編排邏輯經由 UniFFI 提供給 Swift，不在 Swift 中重寫。
3. 平台功能在 Swift 宿主端實作：AX 取詞與寫回、鑰匙圈、Vision OCR、語音、快速鍵與視窗。
4. Provider 是資料；請求以串流輸出，每個請求可各自取消，舊事件不會覆蓋新結果。
5. 金鑰只存放在系統鑰匙圈，不寫入設定、日誌或歷史，對供應商的請求由 Rust 發出。

## 隱私

- 在 BYOK 模式下，請求只會送往你自己設定的端點；umuo 的伺服器收不到你的內容，也收不到你的金鑰。
- 翻譯歷史存放在本機 SQLite，可以搜尋、刪除、設定保留天數，也可以完全關閉。
- 語音在本機轉寫：錄音只寫入暫存檔，轉寫結束或取消後立即刪除，不會傳給 umuo，也不會傳給模型供應商。
- 預設不開啟內容遙測。

## 參與貢獻

歡迎提出 Issue 與 Pull Request（Issue 與 PR 都有範本；**請勿在任何地方貼出你的 API Key**）。安全性漏洞請依照 [SECURITY.md](SECURITY.md) 私下回報，不要開公開的 Issue。開發前請先閱讀 [AGENTS.md](AGENTS.md)（分層規則、指令與測試慣例，人與 agent 共用）及 [CONTRIBUTING.md](CONTRIBUTING.md)；
提交前請在本機跑過 `bun run verify`（修改官網時，另外在 `site/` 執行 `bun run verify`），PR 會再由 CI 跑一次。

## 授權

[MIT](LICENSE)，涵蓋整個儲存庫（含官網 `site/`）。「umuo」名稱與水獺圖示不在 MIT 授權範圍內：散布修改版時請改用其他名稱與圖示；說明作品是以 umuo 為基礎則不受限制。貢獻方式見 [CONTRIBUTING.md](CONTRIBUTING.md)。參考與重用的第三方實作記錄在 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)。
