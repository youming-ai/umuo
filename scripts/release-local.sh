#!/bin/sh
# 在本机发一个 macOS 版本：GitHub Actions 用不了时的发版通道（与 .github/workflows/release.yml 同一套产物与上传顺序）。
#
#   sh scripts/release-local.sh            # 版本号 = 线上版本 + 1
#   sh scripts/release-local.sh 0.1.30     # 指定版本号
#   DRY_RUN=1 sh scripts/release-local.sh  # 只构建、不上传
#
# 前提：
# - 在干净的 main 上，且与 origin/main 一致（发出去的必须是合进主干、能追溯的代码）
# - `rustup target add x86_64-apple-darwin`（通用二进制要两个架构）
# - 更新签名私钥在 ~/.tauri/umuo-updater.key（或用 TAURI_SIGNING_PRIVATE_KEY_PATH 指定）
# - `bunx wrangler login` 过，账号对 umuo-releases 桶有写权限
#
# 发出去的版本会被自动更新静默装到所有用户机器上，所以先跑完整门禁 `bun run verify`。
set -eu

cd "$(dirname "$0")/.."
BUCKET=umuo-releases
KEY_PATH=${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/umuo-updater.key}
r2() { bunx wrangler r2 object "$@" --remote; }

fail() { echo "✗ $*" >&2; exit 1; }

# ---- 前置检查：都在动手之前，失败不留任何痕迹
[ "$(git branch --show-current)" = main ] || fail "请在 main 上发版"
[ -z "$(git status --porcelain)" ] || fail "工作区不干净"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "本地 main 与 origin/main 不一致"
rustup target list --installed | grep -q x86_64-apple-darwin ||
  fail "缺 Intel 目标：rustup target add x86_64-apple-darwin"
[ -f "$KEY_PATH" ] || fail "找不到更新签名私钥 ${KEY_PATH}：不带更新包的版本不发（已装用户会收不到）"

current=$(r2 get "$BUCKET/macos/latest.json" --pipe 2>/dev/null | jq -r '.version // empty' || true)
if [ $# -ge 1 ]; then
  VERSION=$1
else
  [ -n "$current" ] || fail "读不到线上版本，请显式传版本号"
  VERSION=$(echo "$current" | awk -F. '{ printf "%d.%d.%d", $1, $2, $3 + 1 }')
fi
# 线上已是同版或更新的版本就不覆盖：本机重跑一次不能把线上版本退回去
if [ -n "$current" ] && [ "$(printf '%s\n' "$current" "$VERSION" | sort -V | tail -1)" = "$current" ]; then
  fail "线上已是 ${current}，不用 $VERSION 覆盖"
fi
echo "→ 发版 ${VERSION}（线上 ${current:-无}，commit $(git rev-parse --short HEAD)）"

# ---- 门禁
bun run verify

# ---- 构建：版本号只写进本次构建，结束时还原工作区
restore() { git checkout -- Cargo.toml Cargo.lock 2>/dev/null || true; }
trap restore EXIT
sed -i '' -E '/^\[workspace.package\]/,/^\[/ s/^version = ".*"/version = "'"$VERSION"'"/' Cargo.toml
(cd apps/desktop && TAURI_SIGNING_PRIVATE_KEY=$(cat "$KEY_PATH") TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  bunx tauri build --target universal-apple-darwin --bundles app,dmg \
  --config "{\"version\":\"$VERSION\",\"bundle\":{\"createUpdaterArtifacts\":true}}")

out=target/universal-apple-darwin/release/bundle
dmg=$(ls "$out"/dmg/*"$VERSION"*.dmg | head -1)
tgz=$out/macos/umuo.app.tar.gz
[ -f "$dmg" ] && [ -f "$tgz" ] && [ -f "$tgz.sig" ] || fail "构建产物不全"

if [ "${DRY_RUN:-}" = 1 ]; then
  echo "✓ DRY_RUN：产物在 ${out}，未上传"
  exit 0
fi

# ---- 上传：安装包先传，清单最后写——清单指向的文件一定已经完整在线
tmp=$(mktemp -d)
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
dmg_key="macos/umuo-${VERSION}-universal.dmg"
tgz_key="macos/umuo-${VERSION}-universal.app.tar.gz"

r2 put "$BUCKET/$dmg_key" --file "$dmg" --content-type application/x-apple-diskimage
r2 put "$BUCKET/$tgz_key" --file "$tgz" --content-type application/gzip

# 通用二进制里每个架构各自按 darwin-<arch> 查清单，两项指向同一个包
jq -n --arg version "$VERSION" --arg url "https://umuo.app/download/$tgz_key" \
  --arg signature "$(cat "$tgz.sig")" --arg pub_date "$now" \
  '{version: $version, pub_date: $pub_date, platforms: {
     "darwin-aarch64": {url: $url, signature: $signature},
     "darwin-x86_64": {url: $url, signature: $signature}}}' >"$tmp/update.json"
r2 put "$BUCKET/macos/update.json" --file "$tmp/update.json" \
  --content-type application/json --cache-control no-cache

jq -n --arg version "$VERSION" --arg key "$dmg_key" --argjson size "$(stat -f%z "$dmg")" \
  --arg sha256 "$(shasum -a 256 "$dmg" | cut -d' ' -f1)" --arg commit "$(git rev-parse HEAD)" \
  --arg publishedAt "$now" \
  '{version: $version, key: $key, size: $size, sha256: $sha256, commit: $commit, publishedAt: $publishedAt}' \
  >"$tmp/latest.json"
# latest.json 最后写：官网下载以它为准
r2 put "$BUCKET/macos/latest.json" --file "$tmp/latest.json" \
  --content-type application/json --cache-control no-cache

echo "✓ 已发布 $VERSION"
curl -s https://umuo.app/download/macos/update.json | jq -r .version
