#!/bin/sh
# 在本机走一遍发版门禁并组装 SwiftUI 版的发布产物，**不上传任何东西**。
# 正式发布由 .github/workflows/release.yml 在客户端改动合入 main 时完成（GitHub Releases）；
# 这个脚本用于在本机复现同一套产物（Actions 不可用、或发版前想先自己装一遍看看）。
#
#   sh scripts/release-swift-local.sh 0.2.0
#
# 产物在 apps/macos/dist：umuo.app、umuo.dmg、umuo.app.tar.gz、appcast.xml——与 Release 附件同名，
# 必要时可以手动 `gh release create v<版本> --latest …` 原样传上去。
#
# 前提：干净且与 origin/main 一致的 main、两个 rustup 目标、SPARKLE_PUBLIC_ED_KEY 与 Keychain 里的 Sparkle 私钥
# （或 SPARKLE_PRIVATE_KEY_PATH）。签名与公证的环境变量见 apps/macos/scripts/bundle.sh。
set -eu

cd "$(dirname "$0")/.."
OUT="$PWD/apps/macos/dist"
fail() { echo "✗ $*" >&2; exit 1; }

[ $# -eq 1 ] || fail "用法：sh scripts/release-swift-local.sh X.Y.Z"
VERSION=$1
echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "版本号要是 X.Y.Z：$VERSION"

# ---- 前置检查：都在动手之前，失败不留任何痕迹
[ "$(git branch --show-current)" = main ] || fail "请在 main 上构建发布产物"
[ -z "$(git status --porcelain)" ] || fail "工作区不干净"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "本地 main 与 origin/main 不一致"
[ -n "${SPARKLE_PUBLIC_ED_KEY:-}" ] || fail "要设置 SPARKLE_PUBLIC_ED_KEY（Sparkle Ed25519 公钥）"
echo "→ SwiftUI 版 ${VERSION}（commit $(git rev-parse --short HEAD)，只构建）"

# ---- 门禁
bun run verify

# ---- 构建：Rust 内核的版本号（User-Agent、导出配置里的 appVersion）只写进本次构建，结束时还原工作区
restore() { git checkout -- Cargo.toml Cargo.lock 2>/dev/null || true; }
trap restore EXIT
sed -i '' -E '/^\[workspace.package\]/,/^\[/ s/^version = ".*"/version = "'"$VERSION"'"/' Cargo.toml
OUT_DIR=$OUT sh apps/macos/scripts/bundle.sh --version "$VERSION"

bun scripts/sparkle-appcast.ts "$OUT" "$VERSION"

for f in umuo.dmg umuo.app.tar.gz appcast.xml; do
  [ -f "$OUT/$f" ] || fail "构建产物不全：缺 $f"
done
echo "✓ 产物在 ${OUT}（umuo.dmg / umuo.app.tar.gz / appcast.xml），未上传"
