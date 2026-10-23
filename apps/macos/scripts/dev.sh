#!/bin/sh
# 从当前源码编译后启动，避免误验上一轮二进制。
set -eu
root="$(cd "$(dirname "$0")/../../.." && pwd)"
PROFILE=debug sh "$root/apps/macos/scripts/build.sh"
exec "$root/apps/macos/.build/debug/Umuo" "$@"
