#!/bin/sh
# Release runner 导入固定自签名身份；不生成新证书，不输出私钥或密码。
set -eu
umask 077
if [ "${GITHUB_ACTIONS:-}" != true ]; then
  echo '此脚本只用于 GitHub Actions 临时 runner；本机请使用已有签名钥匙串' >&2
  exit 1
fi
test -n "${UMUO_SIGNING_P12_BASE64:-}"
test -n "${UMUO_SIGNING_P12_PASSWORD:-}"
test -n "${RUNNER_TEMP:-}"
test -n "${GITHUB_ENV:-}"

certificate="$PWD/apps/macos/packaging/umuo-signing.pem"
keychain="$RUNNER_TEMP/umuo-signing.keychain-db"
p12="$(mktemp "$RUNNER_TEMP/umuo-signing.XXXXXX")"
trap 'rm -f "$p12"' EXIT
password="$(openssl rand -hex 32)"
echo "::add-mask::$password"
echo '→ 解码签名身份并创建临时钥匙串'
printf '%s' "$UMUO_SIGNING_P12_BASE64" | base64 --decode > "$p12"
security create-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$password" "$keychain"
echo '→ 导入固定证书与私钥，允许 codesign 非交互访问'
security import "$p12" -f pkcs12 -k "$keychain" -P "$UMUO_SIGNING_P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
echo '→ 检查代码签名信任'
# 用户域的信任修改会弹认证框，CI 无人确认就会挂住。只在临时 runner 的管理员域
# 设置 codeSign 信任；sudo -n 无法非交互提权时立即失败，不等待密码，不改变 TLS 信任。
if ! security verify-cert -c "$certificate" -p codeSign >/dev/null 2>&1; then
  echo '→ 在临时 runner 管理员域设置 codeSign 信任'
  sudo -n security add-trusted-cert -d -r trustRoot -p codeSign -k "$keychain" "$certificate"
fi
echo '→ 核对固定签名身份的指纹'
fingerprint="$(openssl x509 -in "$certificate" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d ':')"
security find-identity -v -p codesigning "$keychain" | grep -Fq "$fingerprint"
printf 'APPLE_SIGNING_KEYCHAIN=%s\n' "$keychain" >> "$GITHUB_ENV"
echo '✓ 固定自签名身份已就绪'
