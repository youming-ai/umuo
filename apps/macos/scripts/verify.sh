#!/bin/sh
# verify 门禁里的 SwiftUI 一环（审查 L32）：编内核与绑定 → swift build → swift test → --selftest。
# 与 CI 的 macos-app job 同一组步骤；之前它只在 CI 里，本机 verify 全绿、PR 上却红。
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
# 'TestingMacros' not found"），插件其实在工具链的 host/plugins/testing 里，显式给出路径即可；
# 完整 Xcode 自己找得到，目录不存在就不传，免得指错。
toolchain="$(dirname "$(dirname "$(xcrun -f swift)")")"
plugins="$toolchain/lib/swift/host/plugins/testing"
if [ -d "$plugins" ]; then
  swift test -Xswiftc -plugin-path -Xswiftc "$plugins"
else
  swift test
fi

.build/debug/Umuo --selftest

# 打包冒烟（阶段 5）：把上面这份 debug 产物组装成 ad-hoc 签名的 umuo.app，验 codesign --verify、
# Info.plist 的关键值与资源包位置，再从 .app 里跑一次 --selftest。复用已编好的产物，只多几秒
# （新签名的二进制第一次启动时系统要评估一遍，那一次会慢到二三十秒）。正式的通用二进制、.dmg 不在门禁里跑：
# 两个架构各编一遍 release 要几分钟，见 docs/SWIFTUI-MIGRATION.md「阶段 5」。
sh "$here/scripts/bundle.sh" --quick
