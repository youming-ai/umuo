#!/bin/sh
# verify 门禁里的 SwiftUI 一环：编内核与绑定 → swift build → swift test → --selftest → 打包冒烟。
# CI 的 macos-app job 直接调用本脚本，本机与 CI 不会各写一份而漂移。
#
# 只在 macOS 上跑：别的系统没有 Swift 工具链与 AppKit，跳过而不是失败。
set -eu
if [ "$(uname -s)" != Darwin ]; then
  echo "verify:macos：非 macOS，跳过 SwiftUI 构建与 --selftest（CI 的 macos-app job 仍会跑）"
  exit 0
fi
here="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE=debug "$here/scripts/build-core.sh"
cd "$here"
swift build

# 视图模型与纯规则的验收用例（Swift Testing，Tests/UmuoTests）。
# 只装 Command Line Tools 时 swift test 找不到 TestingMacros 插件（@Test 报 "plugin for module
# 'TestingMacros' not found"），插件其实在工具链的 host/plugins/testing 里，显式给出路径即可。
# 完整 Xcode（CI 的 macos-app 用的就是它）自己找得到，只在当前开发者目录是 CLT 时才传，免得指错。
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

.build/debug/Umuo --selftest

# 打包冒烟：把上面这份 debug 产物组装成 ad-hoc 签名的 umuo.app，验 codesign --verify、
# Info.plist 的关键值与资源包位置，再从 .app 里跑一次 --selftest。复用已编好的产物，只多几秒
# （新签名的二进制第一次启动时系统要评估一遍，那一次会慢到二三十秒）。正式的 arm64 release 组装与 .dmg
# 不在门禁里跑（要再编一遍 release，几分钟）：sh apps/macos/scripts/bundle.sh --version X.Y.Z。
sh "$here/scripts/bundle.sh" --quick
