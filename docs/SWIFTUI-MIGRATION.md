# 发布与 Sparkle 密钥

> 文件名沿用旧的 `SWIFTUI-MIGRATION.md`：源码与官网文档里还有按这个名字（与「必须守住的兼容性」小节）引用它的地方。
> SwiftUI 迁移本身已完成；迁移阶段的记录在 git 历史里。开发命令见 [README](../README.md)，真机走查见 [NATIVE-WALKTHROUGH.md](NATIVE-WALKTHROUGH.md)。

客户端只发 Apple Silicon（arm64）、macOS 14+ 的包。当前为 ad-hoc 签名、**未经 Apple 公证**；Developer ID 公证、
真实 N → N+1 更新实测与 Homebrew Cask 是待办（见 [开发计划](IMPLEMENTATION-PLAN.md) 阶段 G）。

## 自动发布（`.github/workflows/release.yml`）

- **触发**：客户端相关改动（`apps/macos/` 除 `Tests/`、`crates/`、`Cargo.*`、`rust-toolchain.toml`、`package.json`、`bun.lock`、
  `scripts/sparkle-appcast.ts`、`.github/scripts/`、release.yml 本身）合入 main；或在 Actions 里手动运行（workflow_dispatch，可填版本号）。
- **门禁**：先以 workflow_call 跑完整的 `ci.yml`，全部通过才构建。为免同一次合入跑两遍，`ci.yml` 的 push 排除了上面这组路径；
  只改文档时两个工作流都不跑。
- **版本**：`Cargo.toml` `[workspace.package]` 的主.次版本 + 本工作流的运行序号（如 `v0.2.12`）；手动运行可指定 `X.Y.Z`。
  Release 或同名 tag 已存在时直接失败。
- **构建**：macos-15（Apple Silicon）runner，Xcode 26 正式版（`.github/scripts/select-xcode.sh`），Rust 版本由 `rust-toolchain.toml` 固定；
  `apps/macos/scripts/bundle.sh --version <版本>` 编 arm64 release、组装 `.app`、自检、打 `.dmg` 与 `.app.tar.gz`；
  `scripts/sparkle-appcast.ts` 签更新包并生成 appcast。
- **发布**：`gh release create` 发**正式版并标 Latest**（不是预发布），说明里写明 Apple Silicon、macOS 14+ 与未公证的放行方法。
- **并发**：同一时间只发一个版本，进行中的不取消。GitHub 并发组最多只留一个排队中的运行：前一次还在跑时又合入两次，
  先排队的那次会被顶掉，只有最新一次出包（它已包含中间的改动）。
- **权限**：工作流默认 `contents: read`，只有构建发布的 job 有 `contents: write`。

附件名固定，不带版本号：

| 附件 | 用途 |
| --- | --- |
| `umuo-v<版本>.dmg` | 安装包，文件名带版本号；官网 `/download/macos` 由 Worker 读 `releases/latest` 的跳转拿到最新 tag，再 302 到 `releases/download/v<版本>/umuo-v<版本>.dmg` |
| `umuo.app.tar.gz` | Sparkle 更新包；appcast 的 enclosure 指向 `releases/download/v<版本>/umuo.app.tar.gz` |
| `appcast.xml` | Sparkle 清单；包内 SUFeedURL 为 `https://github.com/youming-ai/umuo/releases/latest/download/appcast.xml` |

`releases/latest/download/<固定名>` 永远指向最新的正式 Release，因此发布即上线，官网无需部署、也不存安装包。
不要改附件名，也不要把 Release 标成预发布：预发布不算 latest，下载与更新都会停在上一版。
官网 `/download/macos/appcast.xml` 也 302 到最新的 appcast.xml，早期构建的 SUFeedURL 指向官网这个地址，照样能收到更新。

### 发布失败后的清理

`gh release create` 会同时建 tag 与 Release；失败在上传附件途中时，可能留下草稿 Release 或孤立的 tag，
下一次同版本发布会被防重检查拦下。清理后再重跑：

```bash
gh release view v0.2.N                       # 看是否留下了（草稿）Release
gh release delete v0.2.N --yes --cleanup-tag  # 删 Release 并连同删除 tag
git push origin --delete v0.2.N              # 只剩 tag、没有 Release 时
```

然后在 Actions 里重跑失败的那次运行（版本号不变），或用 workflow_dispatch 指定版本手动发布。
自动版本号含运行序号，新的一次合入会自然用下一个号，不受旧的残留影响。

## 本机组装

`bun run bundle:macos -- --version X.Y.Z`（即 `apps/macos/scripts/bundle.sh`）只产出文件、**不上传**，须在 Apple Silicon 上跑：

- 正式组装需要 `SPARKLE_PUBLIC_ED_KEY`（写进包内 `SUPublicEDKey`）；编一次 arm64 release（独立 scratch 目录 `.build/bundle-arm64`），
  以 macOS 14 为部署目标，嵌入 Sparkle.framework 与 CTranscribe.framework（两者是上游的通用框架，原样嵌入），
  按 Sparkle 官方顺序由内向外重签；没有 Developer ID 时 ad-hoc 签名。
- 组装后自检：codesign、Info.plist 关键值、主程序为 arm64、框架含 arm64 切片、资源包与许可文件位置，再从 `.app` 里跑 `--selftest`。
- `--quick` 复用 `verify.sh` 刚编好的 debug 产物，只做 ad-hoc、不公证、不打 `.dmg`，是 `bun run verify` 里的打包冒烟。

产物在 `apps/macos/dist`：`umuo.app`、`umuo-vX.Y.Z.dmg`、`umuo.app.tar.gz`；再跑 `bun scripts/sparkle-appcast.ts "$PWD/apps/macos/dist" X.Y.Z`
生成 `appcast.xml`。正常发布走 release.yml；本机产物只用于自测。

## Sparkle 原生应用内更新

- SwiftPM 锁定 Sparkle 2.10.0，`App/AppUpdater.swift` 在主线程持有唯一更新会话；菜单和关于页接到原生更新 UI。
- 裸开发构建与 `--quick` 不启动更新；正式包写入 HTTPS feed 与 Ed25519 公钥。
- 不启用系统信息上报，不默认自动安装；自动检查遵循 Sparkle 的用户授权流程。
- ad-hoc 包没有 Team ID，附加开发用的关闭库校验权利；Developer ID 包保留库校验。
- `scripts/sparkle-appcast.ts` 用官方 `sign_update` 签名，再独立以包内公钥验签，生成含最低 macOS 14.0.0 的 appcast；
  签名错误、篡改包与 XML 版本注入由工具测试拦截。

### 密钥

首次准备（只需一次；私钥只进入本机 Keychain）：

```bash
swift package --package-path apps/macos resolve
bin=apps/macos/.build/artifacts/sparkle/Sparkle/bin
"$bin/generate_keys" --account app.umuo.desktop          # 首次会创建签名密钥
```

备份并交给 Release 工作流（私钥只出现在本机的临时文件里，用完即删）：

```bash
"$bin/generate_keys" --account app.umuo.desktop -x ~/Desktop/umuo-sparkle-private.key  # 导出私钥
# 把这个文件存进密码管理器作为离线备份
gh variable set SPARKLE_PUBLIC_ED_KEY --body "$("$bin/generate_keys" --account app.umuo.desktop -p)"
gh secret set SPARKLE_PRIVATE_KEY < ~/Desktop/umuo-sparkle-private.key
rm -P ~/Desktop/umuo-sparkle-private.key
```

换电脑时用 `generate_keys --account app.umuo.desktop -f <备份文件>` 导回 Keychain。**丢了私钥，已发出去的版本就再也收不到更新。**
本机 `sign_update` 默认读 Keychain；自动化用 `SPARKLE_PRIVATE_KEY_PATH` 指向导出的私钥文件，不把私钥放命令参数、日志或仓库。
Release 工作流使用 repository variable `SPARKLE_PUBLIC_ED_KEY` 与 secret `SPARKLE_PRIVATE_KEY`，后者写入权限 600 的临时文件并在退出时删除。

官方依据：[程序化接入](https://sparkle-project.org/documentation/programmatic-setup/)、
[手动签名顺序](https://sparkle-project.org/documentation/sandboxing/#code-signing)、
[发布与 appcast](https://sparkle-project.org/documentation/publishing/)。

## 以后接 Developer ID 签名与公证

`bundle.sh` 已支持：设了 `APPLE_SIGNING_IDENTITY` 就用该身份签名（带 `--timestamp`）；
`APPLE_API_KEY`、`APPLE_API_ISSUER`、`APPLE_API_KEY_PATH` 三个都设了才用 `notarytool --wait` 公证并 staple `.app` 与 `.dmg`。
Release 工作流目前**不传**这些变量，因为 runner 上还没有证书与 API Key 文件。接入时在 release.yml 的构建步骤前补：

1. 把「Developer ID Application」证书导出为 `.p12`，base64 后存为 secret（如 `APPLE_CERTIFICATE_P12`、`APPLE_CERTIFICATE_PASSWORD`）。
2. 构建前建临时 keychain：`security create-keychain` → `security import <p12> -k <keychain> -P <密码> -T /usr/bin/codesign`
   → `security set-key-partition-list -S apple-tool:,apple:,codesign: -k <密码> <keychain>` → `security list-keychains -d user -s <keychain> …`；
   job 结束时 `security delete-keychain`。
3. 把 App Store Connect API Key（`.p8`）存为 secret，构建前写入 `$RUNNER_TEMP` 下权限 600 的文件，作为 `APPLE_API_KEY_PATH`；
   Key ID 与 Issuer ID 作为 `APPLE_API_KEY` / `APPLE_API_ISSUER`。
4. 构建步骤再传 `APPLE_SIGNING_IDENTITY`（证书的完整名称）与上面三个变量；Release 说明去掉「未公证」的放行提示，
   并按 [开发计划](IMPLEMENTATION-PLAN.md) 阶段 G 做 Gatekeeper、DMG 拖装与升级后 Keychain 访问的验收。

## 必须守住的兼容性

- Bundle ID 保持 `app.umuo.desktop`，Keychain service 同名、account 为供应商 id；读取旧文件 Keychain，不能切到另一套存储后让 Key 消失。
- `.app` 名 `umuo.app` 与可执行文件名 `umuo-desktop` 不变，旧 LaunchAgent 指向 `…/umuo.app/Contents/MacOS/umuo-desktop`。
- 配置目录仍为 `~/Library/Application Support/app.umuo.desktop`，由 FFI `defaultConfigDir()` 返回。
- `settings.json` 字段与 camelCase 格式不变，只由 Rust 读写；Swift 只提交 patch，保留未知字段。
- 历史沿用 `history.db` 与 `umuo-store` 的迁移；不要更改已发布迁移。
- 默认键位只影响新装，不改写旧用户保存的键位。
- 附件命名（`umuo-v<版本>.dmg`、`umuo.app.tar.gz`、`appcast.xml`）与 SUFeedURL 不变。
