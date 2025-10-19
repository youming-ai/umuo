# セットアップガイド

このガイドでは、Yabaiiプロジェクトの開発環境をセットアップする手順を説明します。

## 前提条件

### 必須ソフトウェア

- **Node.js**: 18.0.0以上
- **npm**: 9.0.0以上
- **Git**: 2.30.0以上
- **Docker**: 20.10.0以上
- **Docker Compose**: 2.0.0以上

### 推奨ツール

- **Visual Studio Code**: 推奨コードエディタ
- **Expo CLI**: React Native開発用
- **Postman**: APIテスト用
- **DBeaver**: データベース管理用

## 1. 開発環境のセットアップ

### 1.1 リポジトリのクローン

```bash
# リポジトリをクローン
git clone https://github.com/your-username/crushbot.ai.git
cd crushbot.ai

# コミット履歴を確認
git log --oneline
```

### 1.2 Node.jsのインストール確認

```bash
# Node.jsバージョン確認
node --version  # v18.0.0以上

# npmバージョン確認
npm --version   # 9.0.0以上
```

Node.jsをインストールしていない場合：
```bash
# macOS (Homebrew)
brew install node@18

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Windows (Chocolatey)
choco install nodejs
```

### 1.3 Dockerのセットアップ

```bash
# Dockerバージョン確認
docker --version     # 20.10.0以上

# Docker Composeバージョン確認
docker-compose --version  # 2.0.0以上
```

## 2. プロジェクトのインストール

### 2.1 依存関係のインストール

```bash
# ルートの依存関係
npm install

# APIの依存関係
cd api
npm install
cd ..

# モバイルアプリの依存関係
cd apps/mobile
npm install
cd ../..
```

### 2.2 Expo CLIのグローバルインストール

```bash
# Expo CLIをインストール
npm install -g @expo/cli

# バージョン確認
expo --version
```

## 3. 環境変数の設定

### 3.1 API環境変数

```bash
# 環境変数ファイルをコピー
cp api/.env.example api/.env

# 編集
nano api/.env  # お好みのエディタで編集
```

`api/.env`の内容：
```env
# サーバー設定
NODE_ENV=development
PORT=3001
HOST=localhost

# データベース
DATABASE_URL=postgresql://yabaii:password@localhost:5432/yabaii_dev
REDIS_URL=redis://localhost:6379

# JWT認証
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# 外部APIキー
AMAZON_API_KEY=your-amazon-access-key
AMAZON_SECRET_KEY=your-amazon-secret-key
AMAZON_ASSOCIATE_TAG=your-associate-tag
RAKUTEN_APPLICATION_ID=your-rakuten-app-id
RAKUTEN_APPLICATION_SECRET=your-rakuten-secret

# セキュリティ
CORS_ORIGIN=http://localhost:8081,http://localhost:19006
VALID_API_KEYS=dev-api-key-1,dev-api-key-2
API_RATE_LIMIT=1000

# ロギング
LOG_LEVEL=debug
LOG_REQUESTS=true
LOG_HEADERS=true
```

### 3.2 モバイルアプリ環境変数

```bash
# 環境変数ファイルをコピー
cp apps/mobile/.env.example apps/mobile/.env

# 編集
nano apps/mobile/.env
```

`apps/mobile/.env`の内容：
```env
# API設定
EXPO_PUBLIC_API_URL=http://localhost:3001
EXPO_PUBLIC_API_KEY=dev-api-key-1

# 外部API
EXPO_PUBLIC_AMAZON_API_KEY=your-amazon-access-key
EXPO_PUBLIC_RAKUTEN_APPLICATION_ID=your-rakuten-app-id

# 開発設定
EXPO_PUBLIC_DEV_MODE=true
EXPO_PUBLIC_LOG_LEVEL=debug
EXPO_PUBLIC_ENABLE_FLIPPER=true

# アドホック配布（開発用）
EXPO_PUBLIC_DEV_BUILD=true
```

## 4. データベースのセットアップ

### 4.1 Dockerでデータベースを起動

```bash
# Docker Composeでサービスを起動
docker-compose -f docker-compose.dev.yml up -d

# 起動確認
docker-compose ps
```

### 4.2 データベースの初期化

```bash
# APIディレクトリに移動
cd api

# データベースマイグレーション
npm run db:migrate

# サンプルデータを投入
npm run db:seed

# 元のディレクトリに戻る
cd ..
```

### 4.3 データベース接続の確認

```bash
# PostgreSQLに接続
docker exec -it yabaii-db psql -U yabaii -d yabaii_dev

# テーブルを確認
\dt

# 接続を終了
\q
```

## 5. 開発サーバーの起動

### 5.1 APIサーバーの起動

```bash
# APIサーバーを開発モードで起動
npm run api:dev

# 別のターミナルでAPIをテスト
curl http://localhost:3001/health
```

### 5.2 モバイルアプリの起動

```bash
# 新しいターミナルでモバイルアプリを起動
npm run mobile:start

# Expo GoアプリでQRコードをスキャン
# またはウェブブラウザで http://localhost:19006 を開く
```

## 6. 開発ツールの設定

### 6.1 Visual Studio Codeの拡張機能

推奨拡張機能：
```json
{
  "recommendations": [
    "ms-vscode.vscode-typescript-next",
    "bradlc.vscode-tailwindcss",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-eslint",
    "expo.vscode-expo-tools",
    "ms-vscode.vscode-json",
    "redhat.vscode-yaml",
    "ms-vscode-remote.remote-containers"
  ]
}
```

### 6.2 Git Hooksの設定

```bash
# Huskyが自動的にインストールされていることを確認
npm run husky:install

# Pre-commit hookをテスト
git add .
git commit -m "test: setup development environment"
```

## 7. テスト環境のセットアップ

### 7.1 テストデータベース

```bash
# テスト用データベースを作成
docker exec -it yabaii-db psql -U yabaii -c "CREATE DATABASE yabaii_test;"

# テスト用マイグレーション
cd api
DATABASE_URL=postgresql://yabaii:password@localhost:5432/yabaii_test npm run db:migrate
cd ..
```

### 7.2 テスト実行

```bash
# 全テストを実行
npm run test

# APIテストのみ
npm run test:api

# モバイルテストのみ
npm run test:mobile

# カバレッジ測定
npm run test:coverage
```

## 8. デバッグ設定

### 8.1 APIデバッグ

VS Codeで `.vscode/launch.json` を作成：
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug API",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/api/src/index.ts",
      "outFiles": ["${workspaceFolder}/api/dist/**/*.js"],
      "runtimeArgs": ["-r", "ts-node/register"],
      "env": {
        "NODE_ENV": "development"
      },
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

### 8.2 モバイルデバッグ

```bash
# React Native Debuggerを起動
react-native-debugger

# またはFlipperを起動
npx react-native run-android --variant=debug
```

## 9. トラブルシューティング

### 9.1 一般的な問題

**問題**: Node.jsバージョンエラー
```bash
# 解決策
nvm use 18
# または
nvm install 18 && nvm use 18
```

**問題**: ポートが既に使用中
```bash
# 解決策：ポートを確認
lsof -ti:3001 | xargs kill -9
lsof -ti:19006 | xargs kill -9
```

**問題**: 依存関係のインストールエラー
```bash
# 解決策：キャッシュをクリア
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

**問題**: Docker接続エラー
```bash
# 解決策：Dockerサービスを再起動
docker-compose down
docker-compose up -d
```

### 9.2 データベースの問題

**問題**: データベース接続エラー
```bash
# 解決策：データベースの状態を確認
docker-compose logs db

# データベースを再起動
docker-compose restart db
```

**問題**: マイグレーションエラー
```bash
# 解決策：マイグレーションをリセット
cd api
npm run db:migrate:reset
npm run db:migrate
cd ..
```

### 9.3 モバイルアプリの問題

**問題**: Expo起動エラー
```bash
# 解決策：Expo CLIを更新
npm update -g @expo/cli
expo install --fix
```

**問題**: Metroバンドラーの問題
```bash
# 解決策：キャッシュをクリア
npx react-native start --reset-cache
# または
npm run mobile:start -- --reset-cache
```

**問題**: iOSビルドエラー
```bash
# 解決策：Podを更新
cd apps/mobile/ios
pod install
cd ../..
```

## 10. 本番環境のセットアップ

### 10.1 本番用環境変数

```bash
# 本番用環境変数ファイル
cp api/.env.example api/.env.production
cp apps/mobile/.env.example apps/mobile/.env.production
```

### 10.2 本番ビルド

```bash
# APIの本番ビルド
npm run api:build

# モバイルアプリの本番ビルド
npm run mobile:build:prod
```

### 10.3 デプロイ

```bash
# APIデプロイ（Vercel）
npm run deploy:api

# モバイルアプリデプロイ（EAS）
npm run mobile:deploy:production
```

## 11. 開発ワークフロー

### 11.1 ブランチ戦略

```bash
# メインブランチ
git checkout main
git pull origin main

# 機能ブランチを作成
git checkout -b feature/new-feature

# 変更をコミット
git add .
git commit -m "feat: add new feature"

# プッシュしてプルリクエストを作成
git push origin feature/new-feature
```

### 11.2 コミット規約

```bash
# 機能追加
git commit -m "feat: add barcode scanner"

# バグ修正
git commit -m "fix: resolve price display issue"

# ドキュメント
git commit -m "docs: update API documentation"

# スタイル修正
git commit -m "style: format code with prettier"

# リファクタリング
git commit -m "refactor: improve search algorithm"

# テスト
git commit -m "test: add unit tests for price service"
```

### 11.3 品質チェック

```bash
# リント
npm run lint

# 型チェック
npm run type-check

# テスト
npm run test

# ビルド
npm run build
```

## 12. パフォーマンス最適化

### 12.1 開発パフォーマンス

```bash
# 高速リロード有効化
EXPO_PUBLIC_FAST_REFRESH=true

# ソースマップ有効化
EXPO_PUBLIC_SOURCE_MAPS=true

# ホットリロード設定
npm run mobile:start -- --web
```

### 12.2 APIパフォーマンス

```bash
# Redisキャッシュ有効化
REDIS_URL=redis://localhost:6379

# クエリロギング
LOG_LEVEL=info

# 接続プール設定
DB_POOL_SIZE=10
```

## 13. セキュリティ設定

### 13.1 APIキー管理

```bash
# .envファイルを.gitignoreに追加
echo ".env" >> .gitignore
echo "apps/mobile/.env" >> .gitignore
echo "api/.env" >> .gitignore

# 本番環境では環境変数を使用
export JWT_SECRET=$(openssl rand -base64 32)
export DATABASE_URL="postgresql://user:password@host:5432/dbname"
```

### 13.2 CORS設定

```bash
# 開発環境のCORS設定
CORS_ORIGIN=http://localhost:8081,http://localhost:19006,exp://localhost:19000

# 本番環境のCORS設定
CORS_ORIGIN=https://yabaii.day,https://app.yabaii.day
```

---

## 🆘 ヘルプとサポート

セットアップで問題が発生した場合：

1. [ドキュメント](https://docs.yabaii.day)を確認
2. [GitHub Issues](https://github.com/your-username/crushbot.ai/issues)を検索
3. [Discordコミュニティ](https://discord.gg/yabaii)で質問
4. サポートメール: dev-support@yabaii.day

---

<div align="center">
  <strong>🚀 開発の準備が完了しました！</strong>
</div>