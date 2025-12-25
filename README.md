# UMUO - 日本価格比較アプリ

🚀 **Astro + Cloudflare Pages** で構築された高性能な価格比較サイト

[![Astro](https://img.shields.io/badge/Astro-5.16.3-orange?style=flat&logo=astro)](https://astro.build)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare%20Pages-Deploy%20Ready-blue?style=flat&logo=cloudflare)](https://pages.cloudflare.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-3.4+-38B2AC?style=flat&logo=tailwindcss)](https://tailwindcss.com)

## 📋 概要

UMUOは、Amazon、楽天、Yahoo!ショッピングなど主要ECサイトの価格をリアルタイムで比較する日本の価格比較アプリです。AstroフレームワークとCloudflare Pagesを活用し、高速な表示速度と優れたSEOパフォーマンスを実現しています。

### ✨ 特徴

- **⚡ 超高速表示**: 静的サイト生成により初回表示を1秒以下に
- **🔍 リアルタイム価格比較**: 5大主要ECサイトの価格を常に監視
- **📱 完全レスポンシブ**: モバイル、タブレット、デスクトップに対応
- **🎯 AIレビュー要約**: 多数のレビューをAIが分析・要約
- **💰 お得な情報**: 割引セールやクーポン情報を提供
- **🔒 高セキュリティ**: Cloudflareのエッジネットワークで保護

### 🛠️ 技術スタック

| カテゴリ | 技術 |
|---------|------|
| フレームワーク | Astro 5.x (Static Generation) |
| UIライブラリ | React 19 (Islands Architecture) |
| スタイリング | Tailwind CSS 3.x |
| パッケージ管理 | Bun |
| デプロイ | Cloudflare Pages |
| 言語 | TypeScript (Strict Mode) |
| 状態管理 | Zustand + TanStack Query |

## 🚀 クイックスタート

### 前提条件

- [Bun](https://bun.sh) または Node.js 18+

### インストール

```bash
# リポジトリをクローン
git clone https://github.com/umuo/umuo.git
cd umuo

# 依存関係をインストール
bun install

# 開発サーバーを起動
bun run dev
```

### 開発コマンド

```bash
# 開発サーバー起動 (localhost:4321)
bun run dev

# 本番環境ビルド
bun run build

# プレビュー表示
bun run preview

# 型チェック
bunx astro check
```

## 📁 プロジェクト構造

```
src/
├── components/
│   ├── islands/          # React インタラクティブコンポーネント
│   │   ├── SearchBar.jsx
│   │   ├── FilterPanel.jsx
│   │   └── BottomNav.jsx
│   ├── ui/               # 静態 UI コンポーネント
│   │   ├── ProductCard.jsx
│   │   └── Header.astro
│   └── layout/
├── pages/
│   ├── index.astro           # トップページ
│   ├── search.astro          # 検索ページ
│   ├── deals.astro           # 特売ページ
│   ├── compare.astro         # 比較ページ
│   ├── alerts.astro          # 通知ページ
│   ├── profile.astro         # プロフィール
│   ├── products/[slug].astro # 商品詳細
│   ├── categories/           # カテゴリシステム
│   └── api/                  # API エンドポイント
├── layouts/
│   └── BaseLayout.astro
├── lib/
│   └── mock/             # Mock データ・サービス
├── styles/
│   └── global.css
└── store/                # Zustand 状態管理
```

## ⚡ パフォーマンス

### ビルド統計

- **ビルド時間**: < 4 秒
- **生成ページ数**: 116 ページ
- **JavaScript**: Islands のみ（最小限）

### Lighthouse スコア

| 指標 | スコア |
|------|--------|
| Performance | 95+ |
| Accessibility | 98+ |
| Best Practices | 95+ |
| SEO | 100 |

### Core Web Vitals

| 指標 | 値 |
|------|-----|
| LCP | < 1.0s |
| FID | < 50ms |
| CLS | < 0.05 |

## 📚 ドキュメント

詳細なドキュメントは [docs/](./docs/) フォルダをご覧ください：

- [API ドキュメント](./docs/API_DOCUMENTATION.md)
- [ルーティング構造](./docs/ROUTES_DOCUMENTATION.md)
- [開発ガイド](./docs/DEVELOPMENT.md)
- [デプロイガイド](./docs/DEPLOYMENT.md)

## 🤝 貢献

バグ報告や機能リクエストはGitHub Issuesにてお受け付けしております。

1. リポジトリをフォーク
2. 機能ブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add some amazing feature'`)
4. ブランチをプッシュ (`git push origin feature/amazing-feature`)
5. Pull Requestを作成

## 📄 ライセンス

このプロジェクトはMITライセンスの下で公開されています。

---

**UMUO - お得な買い物を、スマートに。** 🛍️✨