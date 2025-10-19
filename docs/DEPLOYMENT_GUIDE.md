# デプロイメントガイド

このガイドでは、Yabaiiモバイルアプリのビルド、テスト、デプロイメント手順を説明します。

## 📋 目次

- [概要](#概要)
- [前提条件](#前提条件)
- [環境設定](#環境設定)
- [ローカル開発](#ローカル開発)
- [ビルドプロセス](#ビルドプロセス)
- [デプロイメント環境](#デプロイメント環境)
- [CI/CDパイプライン](#cicdパイプライン)
- [トラブルシューティング](#トラブルシューティング)

## 🚀 概要

YabaiiモバイルアプリはExpo EAS（Expo Application Services）を使用してビルドとデプロイメントを管理します。これにより、iOS App StoreとGoogle Play Storeへの配布が簡単になります。

### 主要機能

- **マルチ環境ビルド**: 開発、プレビュー、ステージング、本番環境
- **自動化CI/CD**: GitHub Actionsによる自動ビルドとデプロイ
- **コード署名**: 自動化されたiOSとAndroidのコード署名
- **バージョン管理**: セマンティックバージョニング
- **テスト統合**: ビルド前の自動テスト実行

## 🔧 前提条件

### 必須ツール

- **Node.js**: 18.0.0以上
- **npm**: 9.0.0以上
- **Expo CLI**: 最新版
- **EAS CLI**: 最新版
- **Git**: 2.30.0以上

### アカウントとサービス

- **Expoアカウント**: [expo.dev](https://expo.dev)
- **Apple Developer Program**: iOS配布用
- **Google Play Console**: Android配布用
- **GitHubアカウント**: CI/CD用

### インストール

```bash
# Node.jsの確認
node --version  # v18.0.0以上
npm --version   # 9.0.0以上

# Expo CLIのインストール
npm install -g @expo/cli

# EAS CLIのインストール
npm install -g @expo/eas-cli

# 確認
expo --version
eas --version
```

## ⚙️ 環境設定

### 1. Expoアカウント設定

```bash
# Expoにログイン
expo login

# EASにログイン
eas login

# 確認
eas whoami
```

### 2. プロジェクト設定

#### app.jsonの設定

```json
{
  "expo": {
    "name": "Yabaii",
    "slug": "yabaii",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "automatic",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#ffffff"
    },
    "assetBundlePatterns": [
      "**/*"
    ],
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.yabaii.app"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#FFFFFF"
      },
      "package": "com.yabaii.app"
    },
    "web": {
      "favicon": "./assets/favicon.png"
    },
    "plugins": [
      "expo-barcode-scanner",
      "expo-notifications",
      "expo-splash-screen"
    ],
    "extra": {
      "eas": {
        "projectId": "your-project-id"
      }
    }
  }
}
```

#### eas.jsonの設定

```json
{
  "cli": {
    "version": ">= 3.4.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      },
      "ios": {
        "simulator": true
      },
      "channel": "development"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      },
      "ios": {
        "simulator": true
      },
      "channel": "preview"
    },
    "staging": {
      "ios": {
        "autoIncrement": {
          "buildNumber": true,
          "version": false
        },
        "config": {
          "bundleIdentifier": "com.yabaii.app.staging"
        }
      },
      "android": {
        "autoIncrement": {
          "versionCode": true,
          "versionName": false
        },
        "config": {
          "package": "com.yabaii.app.staging"
        }
      },
      "channel": "staging"
    },
    "production": {
      "ios": {
        "autoIncrement": {
          "buildNumber": true,
          "version": false
        },
        "config": {
          "bundleIdentifier": "com.yabaii.app"
        }
      },
      "android": {
        "autoIncrement": {
          "versionCode": true,
          "versionName": false
        },
        "config": {
          "package": "com.yabaii.app"
        }
      },
      "channel": "production"
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "your-apple-id@example.com",
        "ascAppId": "YOUR_APPLE_APP_ID",
        "appleTeamId": "YOUR_APPLE_TEAM_ID"
      },
      "android": {
        "serviceAccountKeyPath": "./android-service-account.json",
        "track": "production"
      }
    }
  }
}
```

### 3. 環境変数

#### .envファイル

```env
# API設定
EXPO_PUBLIC_API_URL=https://api.yabaii.day
EXPO_PUBLIC_API_KEY=your-api-key

# 外部サービス
EXPO_PUBLIC_AMAZON_API_KEY=your-amazon-api-key
EXPO_PUBLIC_RAKUTEN_APPLICATION_ID=your-rakuten-app-id

# 開発設定
EXPO_PUBLIC_DEV_MODE=false
EXPO_PUBLIC_LOG_LEVEL=info
```

## 💻 ローカル開発

### 開発ビルドの作成

```bash
# iOS開発ビルド
./scripts/build.sh dev ios

# Android開発ビルド
./scripts/build.sh dev android

# 両プラットフォーム
./scripts/build.sh dev all
```

### プレビュービルドの作成

```bash
# iOSプレビュー
./scripts/build.sh build ios preview

# Androidプレビュー
./scripts/build.sh build android preview
```

### ローカルテスト

```bash
# 全テスト実行
npm run test

# 単体テスト
npm run test:unit

# 統合テスト
npm run test:integration

# E2Eテスト
npm run test:e2e
```

## 🏗️ ビルドプロセス

### ビルドスクリプトの使用

```bash
# 基本的なビルド
./scripts/build.sh build [platform] [environment]

# 例：
./scripts/build.sh build ios production
./scripts/build.sh build android staging

# ヘルプ表示
./scripts/build.sh help
```

### 手動ビルド

```bash
# EAS CLIを使用したビルド
eas build --platform ios --profile production
eas build --platform android --profile production

# バックグラウンドビルド
eas build --platform ios --profile production --non-interactive

# ビルドの監視
eas build:list
eas build:view [BUILD_ID]
```

### ビルドプロファイル

| プロファイル | 用途 | 配布先 | 自動インクリメント |
|-------------|------|----------|-------------------|
| `development` | 開発・デバッグ | 内部配布 | なし |
| `preview` | プレビュー・テスト | 内部配布 | なし |
| `staging` | ステージングテスト | 内部/テスト配布 | バージョン番号 |
| `production` | 本番配布 | App Store/Play Store | バージョン番号 |

## 🚀 デプロイメント環境

### 開発環境（Development）

- **目的**: 開発者によるテストとデバッグ
- **配布**: Expo開発ビルド、内部テスト
- **トリガー**: コミット時、手動実行
- **自動化**: テスト実行、基本ビルド

### プレビュー環境（Preview）

- **目的**: チームレビューとQAテスト
- **配布**: Expoプレビュービルド、内部テスト
- **トリガー**: プルリクエスト、手動実行
- **自動化**: テスト実行、ビルド、通知

### ステージング環境（Staging）

- **目的**: 本番前の最終テスト
- **配布**: TestFlight、Internal Testing
- **トリガー**: developブランチへのマージ
- **自動化**: 全テスト、ビルド、デプロイ

### 本番環境（Production）

- **目的**: 一般ユーザー向けリリース
- **配布**: App Store、Google Play Store
- **トリガー**: mainブランチへのマージ、手動実行
- **自動化**: 全テスト、ビルド、ストア提出

## 🔄 CI/CDパイプライン

### GitHub Actionsワークフロー

```yaml
# .github/workflows/eas-build.yml

name: EAS Build and Deploy

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Build environment'
        required: true
        default: 'preview'
        type: choice
        options:
          - development
          - preview
          - staging
          - production
```

### ワークフローの段階

1. **テスト段階**
   - リンティング
   - タイプチェック
   - 単体テスト
   - 統合テスト

2. **ビルド段階**
   - Androidビルド
   - iOSビルド
   - アーティファクト生成

3. **デプロイ段階**
   - ストアへの提出
   - 内部テスト配布
   - 通知送信

### シークレット管理

以下のシークレットをGitHubリポジトリに設定：

```bash
# Expo
EXPO_TOKEN=your-expo-token

# iOS
APPLE_ID=your-apple-id@example.com
APPLE_APP_SPECIFIC_PASSWORD=your-app-specific-password

# Android
GOOGLE_SERVICE_ACCOUNT_KEY=your-service-account-key

# コード署名
ANDROID_KEYSTORE_BASE64=your-keystore-base64
ANDROID_KEYSTORE_ALIAS=your-keystore-alias
ANDROID_KEYSTORE_PASSWORD=your-keystore-password
ANDROID_KEY_PASSWORD=your-key-password
```

## 📱 ストア提出

### iOS App Store

#### 前提条件

1. **Apple Developer Programメンバーシップ**
2. **App Store Connect設定**
3. **証明書とプロビジョニングプロファイル**

#### 提出手順

```bash
# ビルド
./scripts/build.sh build ios production

# 提出
./scripts/build.sh submit ios production

# または手動
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

#### 必要情報

- **Bundle Identifier**: `com.yabaii.app`
- **App ID**: App Store Connectで取得
- **Team ID**: Apple Developer Team ID

### Google Play Store

#### 前提条件

1. **Google Play Consoleアカウント**
2. **サービスアカウントキー**
3. **アプリ署名キー**

#### 提出手順

```bash
# ビルド
./scripts/build.sh build android production

# 提出
./scripts/build.sh submit android production

# または手動
eas build --platform android --profile production
eas submit --platform android --profile production
```

#### 必要情報

- **Package Name**: `com.yabaii.app`
- **サービスアカウント**: JSONキーファイル
- **署名キー**: Keystoreファイル

## 🔍 トラブルシューティング

### 一般的な問題

#### ビルド失敗

```bash
# ビルドログの確認
eas build:view [BUILD_ID]

# 詳細なログ
eas build --platform ios --profile production --verbose

# キャッシュクリア
eas build:clear-cache
```

#### 認証エラー

```bash
# ログイン状態確認
eas whoami

# 再ログイン
eas logout
eas login
```

#### 依存関係問題

```bash
# 依存関係の再インストール
rm -rf node_modules package-lock.json
npm install

# Expo CLIの再インストール
npm uninstall -g @expo/cli
npm install -g @expo/cli
```

### プラットフォーム固有の問題

#### iOSビルド

```bash
# Xcodeバージョン確認
xcode-select --version

# シミュレーターの確認
xcrun simctl list devices

# iOS設定の確認
eas build:configure --platform ios
```

#### Androidビルド

```bash
# JDKバージョン確認
java -version

# Android SDKの確認
echo $ANDROID_HOME

# Gradleのクリーン
cd android && ./gradlew clean
```

### パフォーマンスの最適化

#### ビルド時間の短縮

```bash
# 並列ビルド
eas build --platform android --platform ios --profile production

# キャッシュの活用
eas build --cache

# 依存関係の最適化
npm ci --prefer-offline --no-audit
```

#### バンドルサイズの削減

```bash
# バンドル分析
npx expo-optimize

# メトロバンドルアナライザー
npx @expo/webpack-config analyze

# 未使用依存関係の削除
npm prune
```

## 📊 監視と分析

### ビルドメトリクス

- **ビルド時間**: 各環境でのビルド所要時間
- **成功率**: ビルドの成功率と失敗原因
- **デプロイ頻度**: デプロイの頻度とパターン

### アプリ分析

- **クラッシュレート**: 各環境でのクラッシュ発生率
- **パフォーマンス**: アプリの起動時間と応答性
- **ユーザーフィードバック**: ストアレビューとフィードバック

### 監視ツール

- **Expo Dashboard**: ビルドと配布の監視
- **Sentry**: エラー追跡とパフォーマンス監視
- **Firebase Analytics**: ユーザー行動分析
- **App Store Connect / Google Play Console**: ストア分析

## 🔄 ベストプラクティス

### バージョン管理

- **セマンティックバージョニング**: `MAJOR.MINOR.PATCH`
- **自動バージョンインクリメント**: EAS設定を活用
- **変更ログ**: リリースノートの維持

### コード品質

- **テストカバレッジ**: 80%以上を目標
- **コードレビュー**: 全コード変更のレビュー
- **静的解析**: リンターと型チェッカーの活用

### セキュリティ

- **シークレット管理**: 環境変数とシークレットの適切な管理
- **依存関係スキャン**: セキュリティ脆弱性の定期的なチェック
- **コード署名**: 正しい証明書とキーの使用

### デプロイ戦略

- **段階的デプロイ**: ステージング環境での十分なテスト
- **ロールバック計画**: 問題発生時の迅速な対応策
- **コミュニケーション**: チームへの変更通知とドキュメンテーション

---

## 🆘 サポート

デプロイメントに関する問題が発生した場合：

1. [Expoドキュメント](https://docs.expo.dev)を確認
2. [EASビルドドキュメント](https://docs.expo.dev/build/introduction)を参照
3. [GitHub Issues](https://github.com/expo/eas-cli/issues)を検索
4. [Discordコミュニティ](https://discord.gg/expo)で質問

---

<div align="center">
  <strong>🚀 スムーズなデプロイメントを！</strong>
</div>