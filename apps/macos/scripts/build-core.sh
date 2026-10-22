#!/bin/sh
# 编译 Rust 内核（umuo-ffi）并生成 Swift 绑定。`swift build` 之前跑一次；
# 内核或导出层有改动后再跑。产物都是生成物，已在 .gitignore 里。
#
# 静态库单独拷到 .core/lib：target/release 里同名的 .dylib 会被链接器优先选中，
# 那样 .app 就得再带一个动态库，签名、公证都多一步。
#
# UNIVERSAL=1（打包用，scripts/bundle.sh）：分别编 arm64 与 x86_64 两个目标，lipo 成一个通用静态库，
# 之后按任一架构 swift build 都能从同一个 .core/lib 里链到对的那一半。只支持 release。
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$here/../.." && pwd)"
profile="${PROFILE:-release}"

cd "$root"
# 尊重 CARGO_TARGET_DIR：设置了它时 cargo 的产物不在仓库的 target/ 下
target="${CARGO_TARGET_DIR:-$root/target}"
# Sources/UmuoCore 里只有生成物（被 gitignore），新检出的仓库里这个目录不存在
mkdir -p "$here/.core/lib" "$here/.core/bindings" "$here/Sources/UmuoCore"

if [ "${UNIVERSAL:-}" = 1 ]; then
  [ "$profile" = release ] || { echo "UNIVERSAL=1 只支持 release" >&2; exit 1; }
  # 与 Package.swift 的 .macOS(.v14) 一致。不设的话 cc 编的 C / 汇编（ring 等）按本机 SDK 的版本打标，
  # 链接时满屏「built for newer macOS」，在老系统上可能用到没有的指令或符号
  export MACOSX_DEPLOYMENT_TARGET=14.0
  for triple in aarch64-apple-darwin x86_64-apple-darwin; do
    rustup target list --installed | grep -qx "$triple" ||
      { echo "缺目标 ${triple}：rustup target add $triple" >&2; exit 1; }
    cargo build -p umuo-ffi --release --target "$triple"
  done
  # 带 --target 时产物在 <target>/<triple>/release；绑定与架构无关，按本机那一份生成
  lipo -create -output "$here/.core/lib/libumuo_ffi.a" \
    "$target/aarch64-apple-darwin/release/libumuo_ffi.a" "$target/x86_64-apple-darwin/release/libumuo_ffi.a"
  case "$(uname -m)" in arm64) out="$target/aarch64-apple-darwin/release" ;; *) out="$target/x86_64-apple-darwin/release" ;; esac
else
  if [ "$profile" = release ]; then cargo build -p umuo-ffi --release; else cargo build -p umuo-ffi; fi
  out="$target/$profile"
  cp "$out/libumuo_ffi.a" "$here/.core/lib/"
fi
cargo run -q -p umuo-ffi --bin uniffi-bindgen -- generate \
  --library "$out/libumuo_ffi.dylib" --language swift --out-dir "$here/.core/bindings"

cp "$here/.core/bindings/umuo_ffiFFI.h" "$here/Sources/umuo_ffiFFI/include/"
cp "$here/.core/bindings/umuo_ffi.swift" "$here/Sources/UmuoCore/"
echo "umuo-ffi ($profile${UNIVERSAL:+, universal}) → $here/.core/lib/libumuo_ffi.a，绑定已更新"
