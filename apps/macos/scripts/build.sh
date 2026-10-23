#!/bin/sh
# 原生开发构建：先生成 Rust 绑定，再确保可执行文件链接当前静态库。
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${PROFILE:-debug}" sh "$here/scripts/build-core.sh"
# SwiftPM 不把 -L 引入的 Rust 静态库当作构建输入，必须移除旧可执行文件以触发链接。
rm -f "$here/.build/debug/Umuo"
swift build --package-path "$here"
