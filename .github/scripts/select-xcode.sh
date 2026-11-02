#!/bin/sh
# 在 GitHub 的 macOS runner 上切到最新的正式版 Xcode 26（ci.yml 与 release.yml 共用）。
#
# 浮窗用 macOS 26 的 Liquid Glass（glassEffect），要 Xcode 26 的 SDK；镜像默认的 Xcode 16 编不过。
# 只选正式版：名字里带 beta / RC（如 Xcode_26.1_beta.app、Xcode_26.1_Release_Candidate.app）的一律排除，
# 免得构建悄悄用上预览工具链。找不到就直接失败，而不是退回旧 SDK。
set -eu

xcode=$(ls -d /Applications/Xcode_26*.app 2>/dev/null | grep -viE 'beta|_rc|release_candidate' | sort -V | tail -1 || true)
if [ -z "$xcode" ]; then
  echo "runner 上没有正式版 Xcode 26；现有：" >&2
  ls -d /Applications/Xcode*.app >&2 || true
  exit 1
fi
sudo xcode-select -s "$xcode/Contents/Developer"
xcodebuild -version
