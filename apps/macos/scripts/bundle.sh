#!/bin/sh
# 组装 SwiftUI 客户端的 umuo.app（阶段 5）：通用二进制 → Info.plist / 图标 / 资源 → 签名 →（可选）公证 →
# .dmg 与 .app.tar.gz（→ 可选：用 Tauri 更新通道的 minisign 私钥签 .app.tar.gz）。只在本机产出文件，**不上传任何东西**。
#
#   sh apps/macos/scripts/bundle.sh --version 0.2.0                  # 正式组装：arm64 + x86_64，release
#   sh apps/macos/scripts/bundle.sh --version 0.2.0 --updater-sign   # 外加 umuo.app.tar.gz.sig（经 update.json 发给 Tauri 用户）
#   sh apps/macos/scripts/bundle.sh --quick                          # 冒烟：复用 .build/debug 的产物，只本机架构、ad-hoc、不出 .dmg
#
# 环境变量（都可选）：
#   APPLE_SIGNING_IDENTITY   codesign 身份（「Developer ID Application: …」）；不设就 ad-hoc 签名（--quick 一律 ad-hoc，忽略它与 APPLE_API_*）
#   APPLE_API_KEY / APPLE_API_ISSUER / APPLE_API_KEY_PATH
#                            三个都设了才公证（notarytool --wait）并 staple；与 Tauri 打包用的同名变量一致
#   TAURI_SIGNING_PRIVATE_KEY（私钥内容）或 TAURI_SIGNING_PRIVATE_KEY_PATH（默认 ~/.tauri/umuo-updater.key）
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD                       --updater-sign 用；沿用已发布旧客户端的同一把钥匙
#   SPARKLE_PUBLIC_ED_KEY    Sparkle Ed25519 公钥（正式构建必填，generate_keys --account app.umuo.desktop 生成）
#   OUT_DIR                  产物目录，默认 apps/macos/dist（--quick 时 .build/bundle-smoke）
#
# 产物：$OUT_DIR/umuo.app、umuo_<版本>_universal.dmg、umuo.app.tar.gz（+ .sig）。
# 文件名与 Tauri 版一致：.app 叫 umuo.app、可执行文件叫 umuo-desktop（理由见 packaging/Info.plist 开头）。
#
# 每次组装完都会自检（codesign --verify、Info.plist 的关键值、资源包位置），再从 .app 里跑一次 --selftest
# 证明它启动得起来（不开界面、不注册快捷键；直接正常启动的话 Bundle ID 是正式的，会注册真实快捷键）。
set -eu

here="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$here/../.." && pwd)"
fail() { echo "✗ bundle: $*" >&2; exit 1; }
step() { echo "→ $*"; }

quick=0
updater_sign=0
VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --quick) quick=1 ;;
    --updater-sign) updater_sign=1 ;;
    --version) [ $# -ge 2 ] || fail "--version 要跟版本号"; VERSION=$2; shift ;;
    --) ;; # `bun run bundle:macos -- …` 可能把 -- 原样传进来
    -h | --help) sed -n '2,22p' "$0"; exit 0 ;;
    *) fail "认不出的参数：$1" ;;
  esac
  shift
done

[ "$(uname -s)" = Darwin ] || fail "只能在 macOS 上组装"
if [ -z "$VERSION" ]; then
  # 冒烟不关心版本；正式组装必须明说，免得打出一个 0.1.0 的包被当成正式版发出去
  [ "$quick" = 1 ] || fail "正式组装要 --version X.Y.Z"
  VERSION=0.0.0
fi
# CFBundleVersion 只认点分数字；更新通道（semver 比较）也只认这种
echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "版本号要是 X.Y.Z：$VERSION"
[ "$quick" = 1 ] && [ "$updater_sign" = 1 ] && fail "--quick 的包不能拿去签更新：它是 debug 构建"

# 冒烟一律 ad-hoc、不公证：为 Tauri 发版 export 过 APPLE_SIGNING_IDENTITY / APPLE_API_* 的机器上，
# verify 也要保持离线、无 Keychain 弹框（Developer ID + --timestamp 要连 Apple 的时间戳服务、会请求用私钥）
identity=""
notarize=0
if [ "$quick" = 1 ]; then
  [ -z "${APPLE_SIGNING_IDENTITY:-}" ] || echo "（--quick 忽略 APPLE_SIGNING_IDENTITY / APPLE_API_*：冒烟只做 ad-hoc 签名）"
else
  identity="${APPLE_SIGNING_IDENTITY:-}"
  if [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
    [ -n "$identity" ] || fail "公证要 Developer ID 签名：设了 APPLE_API_* 却没设 APPLE_SIGNING_IDENTITY"
    notarize=1
  fi
fi

# 正式包必须带原生更新验签公钥；冒烟不启用更新，不访问签名 Keychain。
if [ "$quick" = 0 ]; then
  [ -n "${SPARKLE_PUBLIC_ED_KEY:-}" ] || fail "正式包要 SPARKLE_PUBLIC_ED_KEY（Sparkle Ed25519 公钥）"
  echo "$SPARKLE_PUBLIC_ED_KEY" | grep -Eq '^[A-Za-z0-9+/]{43}=$' || fail "SPARKLE_PUBLIC_ED_KEY 必须是 32 字节的 Base64 公钥"
fi

if [ "$quick" = 1 ]; then
  OUT_DIR="${OUT_DIR:-$here/.build/bundle-smoke}"
else
  OUT_DIR="${OUT_DIR:-$here/dist}"
fi
mkdir -p "$OUT_DIR"
# 换成绝对路径：下面会 cd 到 apps/macos，相对路径（release-swift-local.sh 从仓库根传的就是）会落到别处
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
app="$OUT_DIR/umuo.app"
exe_name=umuo-desktop

# ---- 编译：正式组装两个架构各编一次再 lipo；冒烟直接用 verify.sh 刚编好的 debug 产物
cd "$here"
if [ "$quick" = 1 ]; then
  bin_dir="$here/.build/debug"
  [ -x "$bin_dir/Umuo" ] && [ -d "$bin_dir/Umuo_Umuo.bundle" ] || fail "没有 .build/debug 的产物：先 swift build（verify.sh 会先编）"
  binaries="$bin_dir/Umuo"
  resources="$bin_dir/Umuo_Umuo.bundle"
else
  step "Rust 内核：arm64 + x86_64 → 通用静态库"
  UNIVERSAL=1 PROFILE=release "$here/scripts/build-core.sh"
  binaries=""
  for arch in arm64 x86_64; do
    step "swift build -c release（${arch}）"
    # 每个架构单独一个 scratch 目录：新的构建系统按 Products/Release 放产物、不分架构，共用的话后编的覆盖先编的。
    # SwiftPM 也不把 -L 给的静态库当输入，库换了（debug ↔ 通用 release）它未必重新链接，
    # 所以链接前先删掉旧的可执行文件，保证里面是这一次的内核
    flags="-c release --triple $arch-apple-macosx14.0 --scratch-path $here/.build/bundle-$arch"
    # shellcheck disable=SC2086
    bin_dir="$(swift build $flags --show-bin-path)"
    rm -f "$bin_dir/Umuo"
    # shellcheck disable=SC2086
    swift build $flags --product Umuo
    binaries="$binaries $bin_dir/Umuo"
    resources="$bin_dir/Umuo_Umuo.bundle"
  done
fi

# ---- 组装
step "组装 ${app}（${VERSION}）"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$app/Contents/Frameworks"
# shellcheck disable=SC2086
if [ "$quick" = 1 ]; then
  cp $binaries "$app/Contents/MacOS/$exe_name"
else
  lipo -create -output "$app/Contents/MacOS/$exe_name" $binaries
  # 去掉本地符号：通用二进制 27 MB → 19 MB（安装包门槛 30 MB）。全局符号留着，崩溃栈仍看得出函数名
  strip -x "$app/Contents/MacOS/$exe_name" 2>/dev/null || fail "strip 失败"
fi
# SwiftPM 可能留下指向构建机 PackageFrameworks 的绝对 rpath。移除后只从包内加载更新框架。
otool -l "$app/Contents/MacOS/$exe_name" | sed -n 's/^ *path \(.*\) (offset .*$/\1/p' |
  while IFS= read -r search_path; do
    case "$search_path" in
      "$here"/.build/*) install_name_tool -delete_rpath "$search_path" "$app/Contents/MacOS/$exe_name" ;;
    esac
  done
sed "s/@VERSION@/$VERSION/g" "$here/packaging/Info.plist" >"$app/Contents/Info.plist"
printf 'APPL????' >"$app/Contents/PkgInfo"
cp "$here/packaging/icon.icns" "$app/Contents/Resources/icon.icns"
# Bundle.module 先在 Bundle.main.resourceURL（Contents/Resources）里找 Umuo_Umuo.bundle（文案表与菜单栏图标）。
# 新构建系统（本机 Swift 6.4）产出标准的 Contents/Resources + Info.plist；旧构建系统（CI 上 Xcode 26 的 swift build）
# 产出平铺、没有 Info.plist 的目录，放进 .app 后 Foundation 不认，Bundle.module 会退回编译时的绝对路径。统一整理成标准结构
bundle_dest="$app/Contents/Resources/Umuo_Umuo.bundle"
if [ -d "$resources/Contents" ]; then
  cp -R "$resources" "$app/Contents/Resources/"
else
  mkdir -p "$bundle_dest/Contents/Resources"
  cp -R "$resources"/. "$bundle_dest/Contents/Resources/"
  cat >"$bundle_dest/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>app.umuo.desktop.resources</string>
  <key>CFBundleName</key><string>Umuo_Umuo</string>
  <key>CFBundlePackageType</key><string>BNDL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
</dict>
</plist>
PLIST
fi
# SwiftPM 的二进制依赖放在 bin_dir；用 ditto 保留 framework 的符号链接与执行权限。
[ -d "$bin_dir/Sparkle.framework" ] || fail "Sparkle.framework 缺失"
ditto "$bin_dir/Sparkle.framework" "$app/Contents/Frameworks/Sparkle.framework"
# 本地语音转写引擎（Package.swift 的 TranscribeCpp 二进制目标，transcribe.cpp v0.4.1）。官方包本身是 arm64 + x86_64 通用的
[ -d "$bin_dir/CTranscribe.framework" ] || fail "CTranscribe.framework 缺失"
ditto "$bin_dir/CTranscribe.framework" "$app/Contents/Frameworks/CTranscribe.framework"
# MIT 要求随二进制附带许可原文：官方包把 transcribe.cpp / ggml / Silero VAD / miniz 的许可放在 xcframework 根目录，
# 不在 framework 里。SwiftPM 解出的产物在各自 scratch 目录的 artifacts 下（冒烟是 .build，正式组装是 .build/bundle-<arch>）
transcribe_license="$(find "$here/.build" -path '*/TranscribeCpp.xcframework/LICENSE' -print -quit)"
[ -n "$transcribe_license" ] || fail "找不到 TranscribeCpp.xcframework 的 LICENSE"
mkdir -p "$app/Contents/Resources/Licenses/transcribe.cpp"
cp "$(dirname "$transcribe_license")"/LICENSE* "$app/Contents/Resources/Licenses/transcribe.cpp/"
if [ "$quick" = 0 ]; then
  plutil -insert SUFeedURL -string 'https://umuo.app/download/macos/appcast.xml' "$app/Contents/Info.plist"
  plutil -insert SUPublicEDKey -string "$SPARKLE_PUBLIC_ED_KEY" "$app/Contents/Info.plist"
  plutil -insert SUAutomaticallyUpdate -bool NO "$app/Contents/Info.plist"
  plutil -insert SUEnableSystemProfiling -bool NO "$app/Contents/Info.plist"
fi
# 麦克风用途说明（系统授权框上显示）：四种语言都取自文案表的 voice.micUsage，不在 Info.plist 与 .strings 里各抄一份。
# Info.plist 里放源语言（简体中文），其余语言按 CFBundleLocalizations 放进 <语言>.lproj/InfoPlist.strings（plist 格式）。
strings_catalog="$here/Sources/Umuo/Resources/Strings/Localizable.xcstrings"
mic_usage() {
  plutil -extract "strings.voice\.micUsage.localizations.$1.stringUnit.value" raw -o - "$strings_catalog"
}
plutil -replace NSMicrophoneUsageDescription -string "$(mic_usage zh-Hans)" "$app/Contents/Info.plist"
for lang in zh-Hans zh-Hant en ja; do
  usage="$(mic_usage "$lang")" || fail "文案表里没有 $lang 的 voice.micUsage"
  mkdir -p "$app/Contents/Resources/$lang.lproj"
  infoplist_strings="$app/Contents/Resources/$lang.lproj/InfoPlist.strings"
  plutil -create xml1 "$infoplist_strings"
  plutil -insert NSMicrophoneUsageDescription -string "$usage" "$infoplist_strings"
done
plutil -lint -s "$app/Contents/Info.plist" || fail "Info.plist 不合法"

# ---- 签名：由内向外。SwiftPM 的资源包是带 _CodeSignature 的嵌套 bundle（里面没有代码），
# 留着 SwiftPM 的 ad-hoc 签名的话，Developer ID 签名与公证会拒；先用同一个身份重签它，再签 .app。
# 不用 --deep：它会给嵌套内容套上同一组权利
sign() {
  if [ -n "$identity" ]; then
    codesign --force --options runtime --timestamp --entitlements "$entitlements" --sign "$identity" "$@"
  else
    # ad-hoc 没有时间戳服务可用；保留 hardened runtime，开发权利只放宽库校验
    codesign --force --options runtime --entitlements "$entitlements" --sign - "$@"
  fi
}
# Sparkle 官方要求按此顺序重签；Downloader 保留上游自己的权利，其余 helper 不套宿主权利。
sign_sparkle() {
  if [ -n "$identity" ]; then
    codesign --force --options runtime --timestamp --sign "$identity" "$@"
  else
    codesign --force --options runtime --sign - "$@"
  fi
}
framework="$app/Contents/Frameworks/Sparkle.framework"
step "签名 Sparkle 的辅助程序与框架"
sign_sparkle "$framework/Versions/B/XPCServices/Installer.xpc"
sign_sparkle --preserve-metadata=entitlements "$framework/Versions/B/XPCServices/Downloader.xpc"
sign_sparkle "$framework/Versions/B/Autoupdate"
sign_sparkle "$framework/Versions/B/Updater.app"
sign_sparkle "$framework"
# 语音引擎框架同 Sparkle：不套宿主权利，只按同一身份重签
step "签名 CTranscribe.framework"
sign_sparkle "$app/Contents/Frameworks/CTranscribe.framework"
entitlements="$here/packaging/umuo.entitlements"
if [ -z "$identity" ]; then
  entitlements="$OUT_DIR/adhoc.entitlements"
  cp "$here/packaging/umuo.entitlements" "$entitlements"
  /usr/libexec/PlistBuddy -c "Add :com.apple.security.cs.disable-library-validation bool true" "$entitlements"
fi
step "签名（${identity:-ad-hoc}）"
sign "$app/Contents/Resources/Umuo_Umuo.bundle"
sign "$app"

# ---- 自检：组装与签名的结果，再从 .app 里启动一次
check() { [ "$2" = "$3" ] || fail "$1：期望 $3，实际 $2"; }
plist_get() { plutil -extract "$1" raw -o - "$app/Contents/Info.plist" 2>/dev/null || echo "<缺>"; }
check CFBundleIdentifier "$(plist_get CFBundleIdentifier)" app.umuo.desktop
check CFBundleExecutable "$(plist_get CFBundleExecutable)" "$exe_name"
check CFBundleShortVersionString "$(plist_get CFBundleShortVersionString)" "$VERSION"
check CFBundleVersion "$(plist_get CFBundleVersion)" "$VERSION"
check LSUIElement "$(plist_get LSUIElement)" true
[ -x "$app/Contents/MacOS/$exe_name" ] || fail "可执行文件不在 Contents/MacOS/$exe_name"
[ -n "$(plist_get NSMicrophoneUsageDescription | grep -v '<缺>')" ] || fail "Info.plist 缺麦克风用途说明"
for lang in zh-Hans zh-Hant en ja; do
  [ -f "$app/Contents/Resources/$lang.lproj/InfoPlist.strings" ] || fail "$lang.lproj/InfoPlist.strings 缺了"
done
for f in LICENSE LICENSE.ggml LICENSE.silero_vad LICENSE.miniz; do
  [ -f "$app/Contents/Resources/Licenses/transcribe.cpp/$f" ] || fail "transcribe.cpp 的 $f 没随包"
done
# 资源包在组装时已统一成标准结构（见上）；后面从 .app 里跑的 --selftest 会确认真的从 .app 里加载
for f in Strings/Localizable.xcstrings Tray; do
  [ -e "$bundle_dest/Contents/Resources/$f" ] || fail "Contents/Resources/Umuo_Umuo.bundle/Contents/Resources/$f 缺了"
done
[ -e "$app/Contents/Resources/icon.icns" ] || fail "Contents/Resources/icon.icns 缺了"
codesign --verify --deep --strict --verbose=2 "$app" 2>/dev/null || { codesign --verify --deep --strict --verbose=2 "$app"; fail "codesign --verify 不通过"; }
codesign -dv "$app" 2>&1 | grep -q 'flags=.*runtime' || fail "没开 hardened runtime"
if [ "$quick" = 0 ]; then
  check SUFeedURL "$(plist_get SUFeedURL)" 'https://umuo.app/download/macos/appcast.xml'
  check SUPublicEDKey "$(plist_get SUPublicEDKey)" "$SPARKLE_PUBLIC_ED_KEY"
  archs="$(lipo -archs "$app/Contents/MacOS/$exe_name")"
  case "$archs" in *arm64*x86_64* | *x86_64*arm64*) ;; *) fail "不是通用二进制：$archs" ;; esac
  framework_archs="$(lipo -archs "$framework/Sparkle")"
  case "$framework_archs" in *arm64*x86_64* | *x86_64*arm64*) ;; *) fail "Sparkle 不是通用框架：$framework_archs" ;; esac
  transcribe_archs="$(lipo -archs "$app/Contents/Frameworks/CTranscribe.framework/CTranscribe")"
  case "$transcribe_archs" in *arm64*x86_64* | *x86_64*arm64*) ;; *) fail "CTranscribe 不是通用框架：$transcribe_archs" ;; esac
fi
step "从 .app 里跑 --selftest（证明启动得起来、资源包找得到）"
log="$OUT_DIR/selftest.log"
if ! "$app/Contents/MacOS/$exe_name" --selftest >"$log" 2>&1; then
  grep -v '^✓' "$log" >&2 || true
  fail "从 .app 启动的 --selftest 失败，完整输出在 $log"
fi
# 资源包必须是从 .app 自己的 Contents/Resources 读到的（不是碰巧找到了 .build 里那一份），Bundle ID 必须是正式的
# 只比到产物目录名为止：Foundation 会把 /private/tmp 报成 /tmp，整条路径逐字比较会误报
grep -q "^✓ resources: .*/$(basename "$OUT_DIR")/umuo.app/Contents/Resources/Umuo_Umuo.bundle（app.umuo.desktop）$" "$log" ||
  fail "资源包不是从 .app 里读到的：$(grep 'resources:' "$log")"
echo "✓ 自检通过：$(grep -c '^✓' "$log") 项 ✓，$(grep -ci 'skipped' "$log" || true) 项因 TCC 未授权跳过"

# ---- 公证：先公证 .app 并 staple，.dmg / .tar.gz 都从 staple 过的 .app 打
notary() {
  xcrun notarytool submit "$1" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait
}
if [ "$notarize" = 1 ]; then
  step "公证 umuo.app"
  zip="$OUT_DIR/umuo-notarize.zip"
  rm -f "$zip"
  ditto -c -k --keepParent "$app" "$zip"
  notary "$zip"
  rm -f "$zip"
  xcrun stapler staple "$app"
fi

# ---- 更新包：顶层恰好一个 umuo.app 目录——Tauri 的更新器会剥掉第一层、换进用户现有的安装位置，
# 再按新 Info.plist 的 CFBundleExecutable 重启
tgz="$OUT_DIR/umuo.app.tar.gz"
rm -f "$tgz" "$tgz.sig"
step "打 $tgz"
COPYFILE_DISABLE=1 tar -czf "$tgz" -C "$OUT_DIR" umuo.app
if [ "$updater_sign" = 1 ]; then
  if [ -z "$identity" ]; then
    # 现在的 Tauri 版本身也是 ad-hoc 发的：每次更新 cdhash 都变，TCC 授权与 Keychain 访问本来就会要重新给一次。
    # 换成 Swift 版这一次也一样，不更糟；有了 Developer ID 之后就不再这样（见 docs/SWIFTUI-MIGRATION.md）
    echo "⚠ ad-hoc 签名的更新包：装上后用户要重新授权辅助功能 / 输入监控 / 屏幕录制，读 Key 会弹一次 Keychain 授权（与现在的 Tauri 更新相同）" >&2
  fi
  step "用更新通道的 minisign 私钥签 $tgz"
  key_path="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/umuo-updater.key}"
  if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    [ -f "$key_path" ] || fail "找不到更新签名私钥：设 TAURI_SIGNING_PRIVATE_KEY 或把私钥放在 $key_path"
  fi
  # 仅显式 --updater-sign 时下载固定版本的旧通道签名工具；不依赖旧客户端。
  # 私钥只经环境变量传入，不出现在命令行（ps 看得见）里
  # （_PATH 要整个去掉：设成空串它也当成「给了路径」而报错）
  (cd "$root" &&
    TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-$(cat "$key_path")}" \
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
      env -u TAURI_SIGNING_PRIVATE_KEY_PATH bunx --package @tauri-apps/cli@2.12.1 tauri signer sign "$tgz")
  [ -s "$tgz.sig" ] || fail "签名文件没写出来：$tgz.sig"
fi

# ---- .dmg：拖进「应用程序」的标准布局；冒烟不打（hdiutil 慢，验的东西上面都验过了）
if [ "$quick" = 0 ]; then
  dmg="$OUT_DIR/umuo_${VERSION}_universal.dmg"
  step "打 $dmg"
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' EXIT
  cp -R "$app" "$stage/"
  ln -s /Applications "$stage/Applications"
  rm -f "$dmg"
  hdiutil create -quiet -volname umuo -srcfolder "$stage" -fs HFS+ -format UDZO -ov "$dmg"
  if [ -n "$identity" ]; then codesign --force --timestamp --sign "$identity" "$dmg"; fi
  if [ "$notarize" = 1 ]; then
    step "公证 .dmg"
    notary "$dmg"
    xcrun stapler staple "$dmg"
  fi
fi

size="$(du -sk "$app" | cut -f1)"
echo "✓ umuo.app ${VERSION}（$((size / 1024)) MB，签名 ${identity:-ad-hoc}$([ "$notarize" = 1 ] && echo '，已公证')）→ $OUT_DIR"
