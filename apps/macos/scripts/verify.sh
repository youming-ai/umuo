#!/bin/sh
# verify 门禁里的 SwiftUI 一环：编内核与绑定 → swift build → swift test → --selftest → 打包冒烟。
# CI 的 macos-app job 直接调用本脚本，本机与 CI 不会各写一份而漂移。
#
#   sh apps/macos/scripts/verify.sh            # 本机：按顺序跑完全部阶段
#   sh apps/macos/scripts/verify.sh test       # 只跑一个阶段：build / test / selftest / bundle
#
# 按阶段调用是给 CI 用的：每个阶段一个步骤、各自设超时，测试挂死时尽快失败，而不是等到 job 的上限。
# test / selftest / bundle 依赖 build 阶段的产物，单独调用时先跑 build。
#
# 只在 macOS 上跑：别的系统没有 Swift 工具链与 AppKit，跳过而不是失败。
set -eu
if [ "$(uname -s)" != Darwin ]; then
  echo "verify:macos：非 macOS，跳过 SwiftUI 构建与 --selftest（CI 的 macos-app job 仍会跑）"
  exit 0
fi
here="$(cd "$(dirname "$0")/.." && pwd)"
stage="${1:-all}"
case "$stage" in
  all | build | test | selftest | bundle) ;;
  *) echo "verify:macos：认不出的阶段 ${stage}（可选 build / test / selftest / bundle）" >&2; exit 1 ;;
esac
run() { [ "$stage" = all ] || [ "$stage" = "$1" ]; }
cd "$here"

if run build; then
  PROFILE=debug "$here/scripts/build-core.sh"
  swift build
fi

# 视图模型与纯规则的验收用例（Swift Testing，Tests/UmuoTests）。
# 只装 Command Line Tools 时 swift test 找不到 TestingMacros 插件（@Test 报 "plugin for module
# 'TestingMacros' not found"），插件其实在工具链的 host/plugins/testing 里，显式给出路径即可。
# 完整 Xcode（CI 的 macos-app 用的就是它）自己找得到，只在当前开发者目录是 CLT 时才传，免得指错。
if run test; then
  toolchain="$(dirname "$(dirname "$(xcrun -f swift)")")"
  plugins="$toolchain/lib/swift/host/plugins/testing"
  case "$(xcode-select -p 2>/dev/null)" in
    */CommandLineTools) [ -d "$plugins" ] && clt_plugins=1 || clt_plugins=0 ;;
    *) clt_plugins=0 ;;
  esac
  if [ "$clt_plugins" = 1 ]; then
    swift test -Xswiftc -plugin-path -Xswiftc "$plugins"
  else
    swift test
  fi
fi

if run selftest; then
  .build/debug/Umuo --selftest
fi

# 打包冒烟：把上面这份 debug 产物组装成 ad-hoc 签名的 umuo.app，验 codesign --verify、
# Info.plist 的关键值与资源包位置，再从 .app 里跑一次 --selftest。复用已编好的产物，只多几秒
# （新签名的二进制第一次启动时系统要评估一遍，那一次会慢到二三十秒）。正式的 arm64 release 组装与 .dmg
# 不在门禁里跑（要再编一遍 release，几分钟）：sh apps/macos/scripts/bundle.sh --version X.Y.Z。
if run bundle; then
  sh "$here/scripts/bundle.sh" --quick
fi
