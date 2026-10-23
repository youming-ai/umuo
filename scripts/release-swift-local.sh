#!/bin/sh
# 在本机构建 SwiftUI 版的发布产物（阶段 5），并可选地经**现有的 Tauri 更新通道**发出去（桥接）。
# 这是唯一的客户端发布脚本；旧客户端构建与发布已删除。
#
#   sh scripts/release-swift-local.sh 0.2.0              # 默认只构建：门禁 → bundle.sh → 在本机写好两份清单，不上传
#   sh scripts/release-swift-local.sh 0.2.0 --publish    # 安装包先、清单后传 R2
#
# 桥接的原理：Tauri 的更新器下载 update.json 指向的 .app.tar.gz、用 tauri.conf.json 里的公钥验 minisign 签名，
# 剥掉压缩包的第一层目录后换进用户现在的安装位置，再按新 Info.plist 的 CFBundleExecutable 重启。
# 所以只要用同一把更新私钥签 Swift 版的 .app.tar.gz，已装 Tauri 版的用户就会被静默换成 Swift 版。
#
# **发之前先想清楚**（docs/SWIFTUI-MIGRATION.md「阶段 5」）：
# - Swift 版目前**没有应用内更新**（Sparkle 还没接）。桥接过去的用户此后收不到任何更新，直到他们自己去官网下载。
#   正常顺序是先接上 Sparkle，再用这个脚本发桥接版。
# - 没有 Developer ID 时是 ad-hoc 签名（与现在的 Tauri 版一样）：用户要重新授权辅助功能等权限、读 Key 弹一次授权框。
# - Swift 版要 macOS 14+（LSMinimumSystemVersion 14.0），Tauri 版是 10.13+。Tauri 的更新器只比版本号与平台键、不看最低系统，
#   macOS 13 及更早的用户也会被换成 Swift 版，之后「重启以更新」起不来、也没有退回的更新路径。
#   所以 --publish 要显式确认 ACK_MIN_OS_14=1（先弄清 14 以下的用户占比再决定）。
#
# 前提：干净且与 origin/main 一致的 main、两个 rustup 目标、更新签名私钥、
# `bunx wrangler login`（只有 --publish 才用到）。签名与公证的环境变量见 apps/macos/scripts/bundle.sh。
set -eu

cd "$(dirname "$0")/.."
BUCKET=umuo-releases
KEY_PATH=${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/umuo-updater.key}
OUT="$PWD/apps/macos/dist"
r2() { (cd site && bunx wrangler r2 object "$@" --remote); }
fail() { echo "✗ $*" >&2; exit 1; }

[ $# -ge 1 ] || fail "要给版本号：sh scripts/release-swift-local.sh X.Y.Z [--publish]"
VERSION=$1
publish=0
[ "${2:-}" = --publish ] && publish=1
echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "版本号要是 X.Y.Z：$VERSION"

# ---- 前置检查：都在动手之前，失败不留任何痕迹
[ "$(git branch --show-current)" = main ] || fail "请在 main 上发版"
[ -z "$(git status --porcelain)" ] || fail "工作区不干净"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "本地 main 与 origin/main 不一致"
[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] || [ -f "$KEY_PATH" ] ||
  fail "找不到更新签名私钥 ${KEY_PATH}：不带更新包的版本不发（已装用户会收不到）"
if [ "$publish" = 1 ]; then
  [ "${ACK_MIN_OS_14:-}" = 1 ] ||
    fail "Swift 版要 macOS 14+，桥接会让 macOS 13 及更早的 Tauri 用户装上起不来的版本；确认可以接受后设 ACK_MIN_OS_14=1 再 --publish"
  current=$(r2 get "$BUCKET/macos/latest.json" --pipe 2>/dev/null | jq -r '.version // empty' || true)
  # 线上已是同版或更新的版本就不覆盖：本机重跑一次不能把线上版本退回去
  if [ -n "$current" ] && [ "$(printf '%s\n' "$current" "$VERSION" | sort -V | tail -1)" = "$current" ]; then
    fail "线上已是 ${current}，不用 $VERSION 覆盖"
  fi
fi
echo "→ SwiftUI 版 ${VERSION}（commit $(git rev-parse --short HEAD)$([ "$publish" = 1 ] && echo '，构建后上传' || echo '，只构建')）"

# ---- 门禁
bun run verify

# ---- 构建：Rust 内核的版本号（User-Agent、导出配置里的 appVersion）只写进本次构建，结束时还原工作区
restore() { git checkout -- Cargo.toml Cargo.lock 2>/dev/null || true; }
trap restore EXIT
sed -i '' -E '/^\[workspace.package\]/,/^\[/ s/^version = ".*"/version = "'"$VERSION"'"/' Cargo.toml
TAURI_SIGNING_PRIVATE_KEY_PATH=$KEY_PATH OUT_DIR=$OUT sh apps/macos/scripts/bundle.sh --version "$VERSION" --updater-sign

dmg=$OUT/umuo_${VERSION}_universal.dmg
tgz=$OUT/umuo.app.tar.gz
[ -f "$dmg" ] && [ -f "$tgz" ] && [ -f "$tgz.sig" ] || fail "构建产物不全"

# ---- 清单：沿用现有线上清单形状，先写在本机
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
dmg_key="macos/umuo-${VERSION}-universal.dmg"
tgz_key="macos/umuo-${VERSION}-universal.app.tar.gz"
# 通用二进制里每个架构各自按 darwin-<arch> 查清单，两项指向同一个包
jq -n --arg version "$VERSION" --arg url "https://umuo.app/download/$tgz_key" \
  --arg signature "$(cat "$tgz.sig")" --arg pub_date "$now" \
  '{version: $version, pub_date: $pub_date, platforms: {
     "darwin-aarch64": {url: $url, signature: $signature},
     "darwin-x86_64": {url: $url, signature: $signature}}}' >"$OUT/update.json"
jq -n --arg version "$VERSION" --arg key "$dmg_key" --argjson size "$(stat -f%z "$dmg")" \
  --arg sha256 "$(shasum -a 256 "$dmg" | cut -d' ' -f1)" --arg commit "$(git rev-parse HEAD)" \
  --arg publishedAt "$now" \
  '{version: $version, key: $key, size: $size, sha256: $sha256, commit: $commit, publishedAt: $publishedAt}' \
  >"$OUT/latest.json"

if [ "$publish" = 0 ]; then
  echo "✓ 只构建：产物与 update.json / latest.json 在 ${OUT}，未上传（要发就加 --publish）"
  exit 0
fi

# ---- 上传：安装包先传，清单最后写——清单指向的文件一定已经完整在线
r2 put "$BUCKET/$dmg_key" --file "$dmg" --content-type application/x-apple-diskimage
r2 put "$BUCKET/$tgz_key" --file "$tgz" --content-type application/gzip
r2 put "$BUCKET/macos/update.json" --file "$OUT/update.json" \
  --content-type application/json --cache-control no-cache
# latest.json 最后写：官网下载以它为准
r2 put "$BUCKET/macos/latest.json" --file "$OUT/latest.json" \
  --content-type application/json --cache-control no-cache

echo "✓ 已发布 SwiftUI 版 $VERSION"
curl -s https://umuo.app/download/macos/update.json | jq -r .version
