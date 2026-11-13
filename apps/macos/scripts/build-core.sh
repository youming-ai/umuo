#!/bin/sh
# 编译 Rust 内核（umuo-ffi）并生成 Swift 绑定。`swift build` 之前跑一次；
# 内核或导出层有改动后再跑。产物都是生成物，已在 .gitignore 里。
#
# 静态库单独拷到 .core/lib：target/release 里同名的 .dylib 会被链接器优先选中，
# 那样 .app 就得再带一个动态库，签名、公证都多一步。
#
# 按宿主架构编（产品只支持 Apple Silicon，正式组装由 bundle.sh 在 arm64 上调用）。
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$here/../.." && pwd)"
profile="${PROFILE:-release}"
# 与 Package.swift 的 .macOS(.v14) 一致；本机构建也不能按当前 SDK 标记 C / 汇编依赖。
# 否则开发与验证时会链接出要求更高系统版本的静态库，出现 built for newer macOS 警告。
export MACOSX_DEPLOYMENT_TARGET=14.0

cd "$root"
# 尊重 CARGO_TARGET_DIR：设置了它时 cargo 的产物不在仓库的 target/ 下
target="${CARGO_TARGET_DIR:-$root/target}"
# Sources/UmuoCore 里只有生成物（被 gitignore），新检出的仓库里这个目录不存在
mkdir -p "$here/.core/lib" "$here/.core/bindings" "$here/Sources/UmuoCore"

# 只编 `-p umuo-ffi`：`--workspace` 会把 umuo-bindgen 开的 uniffi `cli` feature 合并进来，bindgen 一套依赖就混进了发布的静态库。
if [ "$profile" = release ]; then cargo build -p umuo-ffi --release; else cargo build -p umuo-ffi; fi
out="$target/$profile"
cp "$out/libumuo_ffi.a" "$here/.core/lib/"
cargo run -q -p umuo-bindgen --bin uniffi-bindgen -- generate \
  --library "$out/libumuo_ffi.dylib" --language swift --out-dir "$here/.core/bindings"

cp "$here/.core/bindings/umuo_ffiFFI.h" "$here/Sources/umuo_ffiFFI/include/"
cp "$here/.core/bindings/umuo_ffi.swift" "$here/Sources/UmuoCore/"
echo "umuo-ffi ($profile) → $here/.core/lib/libumuo_ffi.a，绑定已更新"
