#!/bin/sh
# 在站点项目内调用锁定版本的 cf；调用方传入 bucket、对象键与其余参数。
r2() { (cd site && bunx --no-install cf r2 objects "$@"); }

# 缺失清单表示尚无版本；认证、网络或清单损坏必须中止，不能跳过版本回退检查。
r2_current_version() {
  r2_key=$1
  r2_bucket=$2
  shift 2
  if r2_result=$(r2 get "$r2_key" --bucket-name "$r2_bucket" --text --quiet "$@" 2>&1); then
    printf '%s' "$r2_result" | jq -er '.version | select(type == "string" and test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))'
  else
    case "$r2_result" in
      *"The specified key does not exist"*) return 0 ;;
      *) printf '%s\n' "$r2_result" >&2; return 1 ;;
    esac
  fi
}
