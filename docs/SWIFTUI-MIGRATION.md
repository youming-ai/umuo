# 发布与 Sparkle 密钥

> 文件名沿用旧的 `SWIFTUI-MIGRATION.md`：源码与官网文档里还有按这个名字（与「必须守住的兼容性」小节）引用它的地方。
> SwiftUI 迁移本身已完成；迁移阶段的记录在 git 历史里。开发命令见 [README](../README.md)，真机走查见 [NATIVE-WALKTHROUGH.md](NATIVE-WALKTHROUGH.md)。

客户端只发 Apple Silicon（arm64）、macOS 14+ 的包。正式包使用固定的 `umuo Self-Signed` 自签名证书签名、**未经 Apple 公证**；Developer ID 公证、
真实 N → N+1 更新实测与 Homebrew Cask 是待办（见 [开发计划](IMPLEMENTATION-PLAN.md) 阶段 G）。

## 自动发布（`.github/workflows/release.yml`）

- **触发**：客户端相关改动（`apps/macos/` 除 `Tests/`、`crates/*/src/` 与 `crates/*/Cargo.toml`（`crates/*/tests/` 只跑 CI）、`Cargo.*`、
  `rust-toolchain.toml`、`package.json`、`bun.lock`、`scripts/sparkle-appcast.ts`、`.github/scripts/`、release.yml 本身；`.md` 一律不算）合入 main；
  或在 Actions 里手动运行（workflow_dispatch，可填版本号）。手动运行只在选 `main` 时出包，填的版本号必须高于当前 Latest。
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
  按 Sparkle 官方顺序由内向外重签；默认固定自签名证书，缺证书或私钥就失败，不降级到 ad-hoc。
- 组装后自检：codesign、Info.plist 关键值、主程序为 arm64、框架含 arm64 切片、资源包与许可文件位置，再从 `.app` 里跑 `--selftest`。
- `--quick` 复用 `verify.sh` 刚编好的 debug 产物，只做 ad-hoc、不公证、不打 `.dmg`，是 `bun run verify` 里的打包冒烟。

产物在 `apps/macos/dist`：`umuo.app`、`umuo-vX.Y.Z.dmg`、`umuo.app.tar.gz`；再跑 `bun scripts/sparkle-appcast.ts "$PWD/apps/macos/dist.noindex" X.Y.Z`
生成 `appcast.xml`。正常发布走 release.yml；本机产物只用于自测。

## Sparkle 原生应用内更新

- SwiftPM 锁定 Sparkle 2.10.0，`App/AppUpdater.swift` 在主线程持有唯一更新会话；菜单和关于页接到原生更新 UI。
- 裸开发构建与 `--quick` 不启动更新；正式包写入 HTTPS feed 与 Ed25519 公钥。
- 不启用系统信息上报，不默认自动安装；自动检查遵循 Sparkle 的用户授权流程。
- 自签名与 ad-hoc 包没有 Team ID，附加关闭库校验权利；Developer ID 包保留库校验。
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

## 固定自签名证书

正式包与 Tinycast 一样使用自行签发的代码签名证书，开启 hardened runtime，没有 Apple Team ID，
不请求 Apple 安全时间戳，也没有 Apple 公证。Gatekeeper 首次下载放行提示仍需保留。
自签名与 Sparkle 的 Ed25519 更新包签名是两套独立密钥；原有 Sparkle 密钥保持不变。

- 公钥证书：`apps/macos/packaging/umuo-signing.pem`，名称 `umuo Self-Signed`，有效期十年。
- 打包脚本从这张证书读取 SHA-1 指纹，按指纹选择身份，不仅按名称匹配，防止误用同名新证书。
- 每次版本发布复用同一份证书与私钥；默认 designated requirement 绑定 Bundle ID 与证书，不能每次生成新证书。
- 首次从 ad-hoc 升级到自签名属于身份变化，TCC 权限与 Keychain 可能需要重新授权/保存 Key；真实升级仍需验收。
- 自签名不等于 Apple 认证；不让用户安装或信任根证书，不关闭用户的 Gatekeeper。

### 本机与备份

本机私密材料在 `~/.config/umuo/signing/`（目录 700，私密文件 600）：
`identity.p12`、`p12-password`、`private-key.pem`、`certificate.pem`、`umuo.keychain-db` 与 `keychain-password`。
这是仓库外的凭据目录，不进 git。请将 `.p12` 与密码存入密码管理器作为独立备份；GitHub Secrets 无法读回备份。
不要重新制证替代丢失的私钥，证书改名也不会恢复原签名身份。

打包默认使用这个本机专用钥匙串（存在时），可通过 `APPLE_SIGNING_KEYCHAIN` 指定其他钥匙串。
锁定后先解锁（不在终端或日志显示密码）：

```bash
security unlock-keychain -p "$(cat ~/.config/umuo/signing/keychain-password)" ~/.config/umuo/signing/umuo.keychain-db
```

换机时从备份导入同一份 `.p12`，创建专用钥匙串、允许 codesign 访问私钥，
并仅对公钥证书设置用户域的 `codeSign` 信任；这一步需要本机用户确认认证框。无需修改系统域或 TLS 信任。
`.github/scripts/import-signing-identity.sh` 专供临时 CI runner，不在本机运行。

### GitHub Actions

仓库 Secrets：`UMUO_SIGNING_P12_BASE64`（`.p12` 文件的 Base64）与 `UMUO_SIGNING_P12_PASSWORD`。
Release 构建前调用 `.github/scripts/import-signing-identity.sh`，使用随机密码创建临时钥匙串、
导入固定身份并核对证书指纹；导入后删除临时 `.p12`，构建后 `always()` 删除临时钥匙串。
用户域信任修改会弹认证框，因此 runner 通过 `sudo -n security add-trusted-cert -d -p codeSign`
在管理员域授权这张公钥证书，不改变 TLS 信任；无非交互 sudo 权限时立即失败。
导入步骤记录阶段且限制两分钟，避免再次静默等待到整个发布 job 的一小时上限。
临时钥匙串加入 runner 用户搜索列表并保留原有路径，供 `codesign` 构建证书链；
导入阶段用同一指纹、同一钥匙串试签临时程序并验证，成功后才导出构建配置，避免只查到身份却无法签名。
2026-11-06：[Release 第 17 次运行](https://github.com/youming-ai/umuo/actions/runs/42180270826)
已验证上述导入与试签、主应用及嵌套框架签名、Sparkle 更新包公钥验签，正式发布 `v0.2.17`，三份附件均上传成功。
不设置这两个 Secrets 时发布失败，不发布身份变化的包。PR 门禁与 `--quick` 不访问发布密钥，仍用 ad-hoc。

## 以后接 Developer ID 签名与公证

`bundle.sh` 保留 Developer ID 路径：设置 `APPLE_SIGNING_IDENTITY="Developer ID Application: …"`，
并通过 `APPLE_SIGNING_KEYCHAIN` 指定导入 Apple 证书与私钥的钥匙串；这一路径保留库校验并请求安全时间戳。
`APPLE_API_KEY`、`APPLE_API_ISSUER`、`APPLE_API_KEY_PATH` 三个都设了才用 `notarytool --wait` 公证并 staple `.app` 与 `.dmg`；
自签名身份或只填部分 API 变量会被提前拒绝。

接入时将 Release 的自签名导入步骤替换为 Developer ID `.p12` 导入，再安全写入 App Store Connect `.p8` 并传上述变量。
完成后才能移除 Release 说明的未公证提示，并按阶段 G 验收 Gatekeeper、DMG 拖装及升级后的 TCC/Keychain。

### 为什么要尽快接：自签名包关闭了库校验

无 Team ID 的自签名与 ad-hoc 包由 `bundle.sh` 加上 `com.apple.security.cs.disable-library-validation`，
否则嵌套框架加载不了；而 umuo 同时持有辅助功能、输入监控、屏幕录制与麦克风授权。
现有缓解是删掉指向构建机的绝对 rpath（组装与自检两处都查），hardened runtime 也不允许 DYLD 环境变量注入；
但只有 Developer ID 签名才能重新打开库校验。这一项在接入前不改，也不要为省事把 Developer ID 路径的库校验关掉。

### 换签名身份时的 Key 迁移

API Key 在旧的文件 Keychain，访问控制列表（ACL）按签名身份认程序。从自签名换成 Developer ID 后，
`SwiftHost.apiKey` 的不弹框读取会得到 `errSecAuthFailed` / `errSecInteractionNotAllowed`，界面提示用户在设置里重新保存 Key。
按代码推断，**预计每个已安装 v0.2.x 的用户都会遇到一次**（首次身份迁移尚未实测，见验收表 R1），Release 说明与首次启动提示要事先写清楚。

借这次必然的重新输入，可以评估改用 Data Protection Keychain（[TN3137](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains)）。
前提：它的访问组来自 `keychain-access-groups` / `application-identifier` 签名权利，这些权利必须由 provisioning profile 授权，
所以除了 Developer ID 证书，还要为 `app.umuo.desktop` 生成并嵌入 Developer ID provisioning profile（`Contents/embedded.provisionprofile`）。
自签名与 ad-hoc 构建没有 Team ID，拿不到这些权利，所以在此之前不能切换。
切换时先读 Data Protection Keychain，读不到再尝试旧的文件 Keychain，成功后写入新位置；
同时保证 CI 与 `--quick` 的 ad-hoc 包仍能走旧路径或明确跳过，`--selftest` 的 Keychain 项相应调整。

## 必须守住的兼容性

- Bundle ID 保持 `app.umuo.desktop`，Keychain service 同名、account 为供应商 id；读取旧文件 Keychain，不能切到另一套存储后让 Key 消失。
- `.app` 名 `umuo.app` 与可执行文件名 `umuo-desktop` 不变，旧 LaunchAgent 指向 `…/umuo.app/Contents/MacOS/umuo-desktop`。
- 配置目录仍为 `~/Library/Application Support/app.umuo.desktop`，由 FFI `defaultConfigDir()` 返回。
- `settings.json` 字段与 camelCase 格式不变，只由 Rust 读写；Swift 只提交 patch，保留未知字段。
- 历史沿用 `history.db` 与 `umuo-store` 的迁移；不要更改已发布迁移。
- 默认键位只影响新装，不改写旧用户保存的键位。
- 附件命名（`umuo-v<版本>.dmg`、`umuo.app.tar.gz`、`appcast.xml`）与 SUFeedURL 不变。
