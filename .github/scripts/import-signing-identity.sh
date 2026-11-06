#!/bin/sh
# Release runner 导入固定自签名身份；不生成新证书，不输出私钥或密码。
set -eu
umask 077
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
printf '%s' "$UMUO_SIGNING_P12_BASE64" | base64 --decode > "$p12"
security create-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$password" "$keychain"
security import "$p12" -f pkcs12 -k "$keychain" -P "$UMUO_SIGNING_P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
# 仅在当前用户域为这张证书设置代码签名信任，不影响 TLS 信任。
if ! security verify-cert -c "$certificate" -p codeSign >/dev/null 2>&1; then
  security add-trusted-cert -r trustRoot -p codeSign -k "$keychain" "$certificate"
fi
fingerprint="$(openssl x509 -in "$certificate" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d ':')"
security find-identity -v -p codesigning "$keychain" | grep -Fq "$fingerprint"
printf 'APPLE_SIGNING_KEYCHAIN=%s\n' "$keychain" >> "$GITHUB_ENV"
