# umuo

<div align="center">

**macOS 向け翻訳・音声入力ツール · 無料のオープンソース · 自分のモデル API キーで使う**

A free, open-source macOS translator: translate in place, select-to-translate, screenshot OCR and voice input — with your own API key.

macOS 14+ · Apple Silicon · Swift + SwiftUI + AppKit · Rust 共有コア · BYOK のみ · MIT ライセンス

[简体中文](README.md) · [English](README.en.md) · [繁體中文](README.zh-TW.md) · **日本語** · [한국어](README.ko.md)

[公式サイト](https://umuo.app) · [ダウンロード（Apple Silicon）](https://umuo.app/download/macos) · [すべてのバージョン](https://github.com/youming-ai/umuo/releases) · [コントリビューションガイド](CONTRIBUTING.md)

[![Release](https://img.shields.io/github/v/release/youming-ai/umuo?label=release)](https://github.com/youming-ai/umuo/releases/latest)
[![CI](https://github.com/youming-ai/umuo/actions/workflows/ci.yml/badge.svg)](https://github.com/youming-ai/umuo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%2014%2B%20%C2%B7%20Apple%20Silicon-lightgrey)

</div>

---

## umuo とは

umuo は macOS ネイティブの翻訳・音声入力ツールです。現在の製品範囲は次のとおりです。

| 柱 | 範囲 | 現在の状況 |
| --- | --- | --- |
| テキスト翻訳 | 選択翻訳（⌃⌃）、テキスト翻訳（⌥⌘A）、入力欄をその場で置換（⌥⌥）。コピー・読み上げ・軽量な結果ウィンドウ | 実装済み、実機での受け入れ確認待ち |
| OCR スクリーンショット翻訳 | システムの範囲選択（⌥⌘O）、Apple Vision によるローカル認識、原文を修正してから翻訳 | 実装済み、実機での受け入れ確認待ち |
| 音声入力 | ⌥⌘V を押したまま話すと読みやすい文章に整え、⌃⌘V を押したまま話すと翻訳先の言語に翻訳。文字起こしは Mac 上で行い、結果は元の入力欄に書き戻す | 実装済み、実機での受け入れ確認待ち |

umuo は完全に無料で、MIT ライセンスのオープンソースです。BYOK のみで動作します。モデルの API キーはご自身で用意し、モデルの利用料はプロバイダーへ直接支払います。umuo 自体は料金を一切取らず、ライセンス、試用期間、サブスクリプション、公式の利用枠、AI ゲートウェイもありません。

モデルの API キーはシステムのキーチェーンに保存され、プロバイダーへのリクエストはこの Mac から、ご自身で設定したエンドポイントへ直接送られます。音声は Mac 上で transcribe.cpp + Qwen3-ASR-0.6B により文字起こしされるため、
音声用の API キーは別途不要です。整形と翻訳にはテキスト用のモデルを使います。クラウドのテキストモデルを使う場合、書き起こしたテキストはそのプロバイダーへ送信されます。

## ダウンロードとインストール

[umuo.app/download/macos](https://umuo.app/download/macos) からダウンロードしてください（macOS 14 以降、Apple Silicon 専用）。
[GitHub Releases](https://github.com/youming-ai/umuo/releases) の最新版インストーラ（`umuo-v<バージョン>.dmg`）へ移動します。クライアントの変更が `main` にマージされるたびに新しい正式版（Latest 表示）が自動で公開され、
インストール済みのアプリでは「設定 › このアプリについて」からアップデートを確認できます。
インストーラはまだ Apple の公証を受けていません。初回起動がブロックされた場合は、**システム設定 → プライバシーとセキュリティ** で「このまま開く」を押してください。
下記の「ソースからビルド」に沿って自分でビルドすることもできます。Homebrew でのインストールはまだ提供していません（[開発計画](docs/IMPLEMENTATION-PLAN.md) の「TODO」を参照）。

## 現在の状況と開発ドキュメント

2026-11-13：ネイティブクライアント、Sparkle による自動アップデート、音声入力（録音、Mac 上での文字起こし、整形／翻訳、入力欄への書き戻し）が完成しました。
クライアントの変更は `main` にマージされると GitHub Releases へ自動で公開されます（`v0.2.<連番>`、正式版、インストーラは `umuo-v<バージョン>.dmg`）。
正式版は固定の自己署名証明書で署名されており、**Apple の公証は受けていません**。Developer ID による署名と公証には有料の Apple Developer アカウントが必要なため、現時点では見送っています。
実機での受け入れ確認はこれからです。初版の範囲を絞るため、複数モデルの比較、スタイル・用語管理、費用予算、お気に入りなどの旧機能は削除しました（旧データは保持しています）。

以下の開発ドキュメントは簡体字中国語で書かれています。

- [プロダクト要件](docs/PRD.md)：現在の機能とビジネス上の線引き。
- [初版の開発計画](docs/IMPLEMENTATION-PLAN.md)：機能の絞り込み、音声、オープンソース化、リリースの順序と完了条件。
- [実装・受け入れチェックリスト](docs/PRD-CONFORMANCE.md)：実装済みのコード、範囲の見直し、未実装の項目、実機での受け入れ確認。
- [Handy 音声調査](docs/research/handy-voice-analysis.md)：ソースコード上の根拠とローカルエンジンの実験方針。
- [リリースと Sparkle の鍵](docs/SWIFTUI-MIGRATION.md)：GitHub Releases への自動リリース、失敗時の後始末、鍵の管理、将来公証に対応する手順。
- [実機ウォークスルー](docs/NATIVE-WALKTHROUGH.md)：テキスト・スクリーンショット・音声の実機受け入れ表と、パフォーマンス計測の基準。
- [コントリビューションガイド](CONTRIBUTING.md)：ライセンス、開発前の注意事項、PR の要件。
- [セキュリティポリシー](SECURITY.md)：セキュリティ脆弱性を非公開で報告する方法。

公式サイト [umuo.app](https://umuo.app)（1 ページ構成のトップページ）と Worker は [site/](site/) にあり、`main` にマージされると Cloudflare Workers Builds で自動デプロイされます。

## ソースからビルド

必要なもの：Apple Silicon 搭載の Mac、macOS 14 以降。Xcode 26（または macOS 26 SDK を含む Command Line Tools。パネルで Liquid Glass を使うため）、
[rustup](https://rustup.rs)（Rust のバージョンは `rust-toolchain.toml` で固定され、初回ビルド時に自動でインストールされます）、[Bun](https://bun.sh) 1.4 以降（`package.json` の `packageManager` に従います）。

```bash
bun install          # リポジトリのツールスクリプトの依存関係
cargo fetch          # Rust の依存関係

bun run dev:macos    # Rust バインディングと SwiftUI クライアントをビルドして起動（macOS 14+、Swift 6）
# 開発ビルドは既定でグローバルショートカットを登録しません。ほかのインスタンスを終了してから bun run dev:macos --hotkeys を使ってください
```

## 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `bun run dev:macos` | SwiftUI クライアントをビルドして起動 |
| `bun run build` | Rust バインディングとネイティブクライアントをビルド |
| `bun run bundle:macos -- --version X.Y.Z` | Apple Silicon（arm64）向けの `.app` / `.dmg` / `.app.tar.gz` を生成。Sparkle の公開鍵の設定が必要。アップロードはしない |
| `bun run icons` | ネイティブアプリの ICNS とメニューバー用 PNG を直接生成 |
| `bun run lint` / `bun run format` | ツールスクリプトの Biome チェック／フォーマット |
| `bun run type-check` | ツールスクリプトの TypeScript 型チェック |
| `bun run test:rust` | Rust workspace の単体テストとパイプラインの回帰テスト |
| `bun run verify:macos` | Swift のビルド、Swift Testing、FFI のセルフチェック、パッケージのスモークテスト |
| `bun run verify` | コミット前の総合チェック。GitHub Actions の CI と同じ内容 |

### 選択翻訳を動かすにはシステムの許可が一度必要です

クライアントを起動したら、まず **設定 → エンジン** でいずれかのプロバイダーの API キーを入力し、
**システム設定 → プライバシーとセキュリティ → アクセシビリティ** で `umuo` をオンにしてください（開発モードでは、umuo を実行しているターミナルや IDE をオンにします）。
この権限がないと、クライアントは選択したテキストを読み取れません。その場合は黙って失敗するのではなく、パネルがその旨をはっきり知らせます。

あとはどのアプリでもテキストを選択して **⌃** を 2 回続けて押せば（⌃⌃）、マウスカーソルの近くのパネルに訳文がストリーミング表示されます。

### 音声入力

任意の入力欄で **⌥⌘V** を押したまま話すと、離したときに読みやすい文章に整えて入力欄へ書き戻します。**⌃⌘V** を押したまま話すと、翻訳先の言語に翻訳してから書き戻します。
初回利用時にはマイクへのアクセス許可を求められ、Hugging Face から約 560 MB の文字起こしモデルをダウンロードします。入力欄への書き戻しにもアクセシビリティの許可が必要です。
どちらのキーも **設定 → 翻訳 → 音声入力** で変更できます。

## リポジトリ構成

```
apps/macos/          Swift + SwiftUI + AppKit のネイティブクライアント（SwiftPM）
  Sources/Umuo/      App、Platform、Panel、Compose、Voice、History、Settings、Onboarding、Quick
  Tests/UmuoTests/   Swift Testing：ビューモデルと純粋なルール
  packaging/         Info.plist、アイコン、署名用の権限設定
  scripts/           Rust バインディングのビルド、ネイティブ開発、検証、パッケージング
crates/umuo-ffi/     UniFFI のエクスポートと型変換（アプリにリンクされる静的ライブラリ）
crates/umuo-bindgen/ Swift バインディングを生成する uniffi-bindgen（ビルド時のみ使用、配布物には含まない）
crates/umuo-app/     共有アプリロジック：設定、翻訳パイプライン、音声セッションと後処理、履歴
  tests/             ローカル SSE パイプラインの回帰テストとイベント互換性のスナップショット
crates/umuo-core/    プラットフォーム非依存の翻訳カーネル：Provider、Prompt、ストリーミング解析、計量
crates/umuo-store/   ローカル SQLite：履歴（旧お気に入りと使用量テーブルはデータのみ保持）
site/               公式サイトと Worker、独立した Bun プロジェクト
scripts/            アイコン生成、サードパーティライセンスの確認、ネイティブリリース用ツール
docs/              PRD、アーキテクチャ、リリース、実機ウォークスルー、受け入れチェックリスト
```

## アーキテクチャの原則

1. UI は SwiftUI、ウィンドウとシステム機能は AppKit と Apple のネイティブ API を使います。操作性は Apple Human Interface Guidelines に従います。
2. `umuo-app` と `umuo-core` はプラットフォーム非依存に保ち、Linux 上でもテストできるようにします。アプリのオーケストレーションは UniFFI 経由で Swift に提供し、Swift で書き直しません。
3. プラットフォーム固有の機能は Swift ホスト側で実装します：AX によるテキスト取得と書き戻し、キーチェーン、Vision OCR、音声、ショートカット、ウィンドウ。
4. Provider はデータとして扱います。リクエストはストリーミングで出力し、リクエストごとに個別にキャンセルでき、古いイベントが新しい結果を上書きすることはありません。
5. API キーはシステムのキーチェーンにのみ保存し、設定ファイル、ログ、履歴には含めません。プロバイダーへのリクエストは Rust から送信します。

## プライバシー

- BYOK モードでは、リクエストはご自身で設定したエンドポイントにのみ送られます。umuo のサーバーがあなたの内容や API キーを受け取ることはありません。
- 翻訳履歴は Mac 上の SQLite に保存されます。検索・削除ができ、保存日数を設定したり、記録を完全にオフにしたりできます。
- 音声は Mac 上で文字起こしします。録音は一時ファイルにのみ書き込まれ、文字起こしの完了またはキャンセル後すぐに削除されます。umuo にもモデルのプロバイダーにも送信されません。
- コンテンツのテレメトリは既定でオフです。

## コントリビューション

Issue と Pull Request を歓迎します（Issue と PR にはテンプレートがあります。**API キーはどこにも貼り付けないでください**）。セキュリティ脆弱性は公開の Issue にせず、[SECURITY.md](SECURITY.md) に従って非公開で報告してください。開発を始める前に [AGENTS.md](AGENTS.md)（レイヤー構成のルール、コマンド、テストの約束事。人間とエージェント共通）と [CONTRIBUTING.md](CONTRIBUTING.md) をお読みください。
コミット前にローカルで `bun run verify` が通ることを確認してください（公式サイトを変更した場合は、`site/` でも `bun run verify` を実行してください）。PR では CI が同じチェックをもう一度実行します。

## ライセンス

[MIT](LICENSE)。リポジトリ全体（公式サイト `site/` を含む）が対象です。「umuo」の名称とカワウソのアイコンは MIT ライセンスの対象外です。改変版を配布する場合は別の名称とアイコンを使ってください。umuo をもとにした作品であると明記することは制限されません。コントリビューションの方法は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。参考・再利用したサードパーティの実装は [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) に記載しています。
