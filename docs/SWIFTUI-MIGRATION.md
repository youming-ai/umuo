# SwiftUI 迁移与发布记录

> 2026-10-22 用户要求清理旧实现。当前唯一客户端是 Swift + SwiftUI + AppKit，最低 macOS 14。
> Rust 翻译内核、应用逻辑与 SQLite 保留，经 UniFFI 调用。
> 旧源码清理已完成；2026-10-23 已接入 Sparkle，正式发布、更新闭环实测与真机验收仍未完成。

产品范围已收敛为文字、OCR 和语音三项核心；开发顺序见 [首版开发计划](IMPLEMENTATION-PLAN.md)。
本记录的迁移阶段描述原生改造，不替代新范围的验收状态。

## 阶段状态

| 阶段 | 状态与证据 |
| --- | --- |
| 0 UniFFI 链路 | ✅ `umuo-ffi`、`build-core.sh` 与 Swift `--selftest` |
| 1 共享应用逻辑与导出 | ✅ `umuo-app` 保存编排逻辑，Engine 导出翻译、对比、设置、历史、术语表、用量等；流水线回归迁到 `crates/umuo-app/tests/pipeline.rs` |
| 2 Swift 平台层 | ✅ AX 取词与写回、Keychain、剪贴板降级、Carbon 组合键、CGEventTap 连按、系统框选、Vision OCR、朗读、LaunchAgent 均在 `Platform/`；真实系统权限与焦点仍需验收 |
| 3 原生窗口 | ✅ 浮窗、设置、撰写、历史、首次引导、菜单栏快捷面板及 Swift Testing 已实现；对比窗已于阶段 A 精简移除；见 `Sources/Umuo/` 与 `Tests/UmuoTests/` |
| 4 收费许可证 | ⬜ 2026-10-23 改为一次性买断、纯 BYOK；购买授权进入开发计划，商业参数与实现待完成，见 `IMPLEMENTATION-PLAN.md` 阶段 F |
| 5 打包与分发 | 🟡 通用 `.app`、`.dmg`、`.app.tar.gz` 与本机打包冒烟已实现；Sparkle 已接入；合入 main 自动发布到 GitHub Releases；Developer ID / 公证、更新闭环实测、Homebrew Cask 待完成 |
| 6 清理与切换 | 🟡 已删除 `apps/desktop`、`umuo-platform*`、`packages/tokens`、旧发布脚本与 WebView CI；正式发布切换未完成 |

## 当前目录与开发

```text
apps/macos/
  Package.swift                     Swift 6 / macOS 14，SwiftPM 包
  Sources/Umuo/                     SwiftUI 界面、AppKit 窗口、平台能力与自检
  Sources/UmuoCore/                 生成的 Swift 绑定，不提交
  Sources/umuo_ffiFFI/               C 模块，头文件由构建生成
  Tests/UmuoTests/                  Swift Testing
  packaging/                       Info.plist、ICNS、entitlements
  scripts/build-core.sh             Rust 静态库与 UniFFI 绑定
  scripts/build.sh                  生成绑定并强制重新链接当前 Rust 静态库
  scripts/dev.sh                    从源码编译后启动
  scripts/verify.sh                 原生客户端完整门禁
  scripts/bundle.sh                 通用安装包或本机打包冒烟
crates/umuo-{core,app,ffi,store}/    平台无关业务、桥接与存储
```

```bash
bun install
bun run dev:macos                    # 编译并启动；默认不注册快捷键
bun run dev:macos --hotkeys          # 先退出其他 umuo 实例
bun run verify                      # 根工具、Rust、Swift 与打包冒烟
bun run bundle:macos -- --version X.Y.Z
```

Rust 静态库在本机开发与通用打包时统一以 macOS 14 为部署目标，避免 C / 汇编依赖按当前 SDK 抬高最低版本。
内核或导出层改变后必须重新生成绑定；`dev:macos` 与原生验证脚本会自动执行这一步。
正式 `app.umuo.desktop` 包默认注册快捷键，开发裸二进制需 `--hotkeys`；`--no-hotkeys` 用于排查。
不要用旧产物验当前源码，也不要让多个实例抢同一组快捷键。

## Apple 原生界面与工具链

交互遵循 Apple Human Interface Guidelines，优先使用 SwiftUI 标准控件、系统语义颜色、字体和 SF Symbols；
AppKit 提供非激活 NSPanel、NSStatusItem、NSPopover 和窗口管理。
自定义主题与 `Palette.swift` 已删除，界面改用系统控件、语义色与 Liquid Glass（macOS 26）/ 系统材质（14–15）；旧设置里的 `uiScale` 与 `highContrast` 保留但不再生效。原生控件、VoiceOver、键盘导航、减少动态效果与增强对比度须继续真机走查，macOS 14/15 与 26 的观感要分别看。
删除旧 CSS 不代表已经完成所有视觉规范对齐。

只装 Command Line Tools 也能构建：

- Swift Testing 的 TestingMacros 由 `verify.sh` 自动查找并传入工具链插件路径；完整 Xcode 无需绕行。
- CLT 缺少 xcstringstool，因此整个 `Resources/Strings` 目录原样复制，`L10n.swift` 运行时读取 String Catalog。
  后续文案直接改 `Localizable.xcstrings`，旧 TS 文案导出脚本已删除。
- 资源包放在 `.app/Contents/Resources`；打包脚本校验 Bundle ID、资源位置、签名和二进制架构，并从包内跑 selftest。
- 图标生成直接写入 `packaging/icon.icns` 与 `Resources/Tray`，不再依赖旧客户端目录。

## 阶段 5：打包与发布

`bun run bundle:macos -- --version X.Y.Z` 只产出文件，不上传。
正式组装需设置 `SPARKLE_PUBLIC_ED_KEY`，写入包内 `SUPublicEDKey`；冒烟包不配置更新通道、不联网检查。
脚本分别构建 arm64 与 x86_64 的 Rust 静态库和 Swift release 二进制，独立 scratch 目录后 lipo 成通用二进制。
以 macOS 14 为部署目标，组装 `.app` 并嵌入 Sparkle.framework，按官方顺序重签 XPC、Autoupdate、Updater.app、框架、宿主；无 Developer ID 时使用 ad-hoc。
`APPLE_SIGNING_IDENTITY` 配置签名身份；`APPLE_API_KEY`、`APPLE_API_ISSUER`、`APPLE_API_KEY_PATH` 同时存在时调用 notarytool 并 staple。
`bundle.sh --quick` 复用本机 debug 产物，只做 ad-hoc，不公证、不生成 DMG，供离线门禁使用。

Release 工作流（`.github/workflows/release.yml`）：客户端改动（`apps/macos/`、`crates/`、`Cargo.*`）合入 main 后，先跑完整 CI，再构建通用安装包，
以 `v0.2.<运行序号>` 发布到 GitHub Releases：**正式版并标 Latest**（`--latest`，不是预发布），说明里写明尚未经 Apple 公证、
首次打开需在「隐私与安全性」放行。也可在 Actions 手动运行并指定版本。版本号的主.次取自 `Cargo.toml` 的 `[workspace.package]`。

附件名固定，不带版本号：

| 附件 | 用途 |
| --- | --- |
| `umuo.dmg` | 通用安装包；官网 `/download/macos` 302 到 `releases/latest/download/umuo.dmg` |
| `umuo.app.tar.gz` | Sparkle 更新包；appcast 的 enclosure 指向 `releases/download/v<版本>/umuo.app.tar.gz` |
| `appcast.xml` | Sparkle 清单；包内 SUFeedURL 为 `https://github.com/youming-ai/umuo/releases/latest/download/appcast.xml` |

`releases/latest/download/<固定名>` 永远指向最新的正式 Release，因此发布即上线，官网无需部署、也不存安装包（R2 已下线）。
不要改附件名，也不要把 Release 标成预发布：预发布不算 latest，下载与更新都会停在上一版。
官网 `/download/macos/appcast.xml` 也 302 到最新的 appcast.xml，早期构建的 SUFeedURL 指向官网这个地址，因此照样能收到更新。

`bun run release:swift X.Y.Z` 是本机的「门禁 + 组装」：在干净、与 origin/main 一致的 main 上跑 `bun run verify`，
构建通用包并生成 appcast，产物与 Release 附件同名，放在 `apps/macos/dist`，**不上传**。Actions 不可用时可据此手动
`gh release create v<版本> --latest …` 上传。仓库公开后 GitHub Actions 不受用量限制，正常情况下由 release.yml 自动发布；手动发布前先在本机跑 `bun run verify`。
旧 `release:local` 和 Tauri 构建工作流已删除，不再产出旧客户端。

### Sparkle 原生应用内更新（2026-10-23）

已实现：

- SwiftPM 锁定 Sparkle 2.10.0，`App/AppUpdater.swift` 在主线程持有唯一更新会话。
- 菜单和关于页接到原生更新 UI，跟随 `canCheckForUpdates` 禁用重复检查。
- 裸开发构建与 `--quick` 不启动更新；正式包写入 HTTPS feed 与 Ed25519 公钥。
- 不启用系统信息上报，不默认自动安装；自动检查遵循 Sparkle 的用户授权流程。
- 打包嵌入完整 Sparkle 框架，按官方顺序签嵌套程序，再以 `codesign --verify --deep --strict` 检查。
  Developer ID 包保留库校验；无 Team ID 的 ad-hoc 包添加开发用关闭库校验权利。
- `scripts/sparkle-appcast.ts` 用官方 `sign_update` 签名，再独立以包内公钥验签，生成含最低 macOS 14.0.0 的 appcast。
- appcast 与更新包随每次 Release 一起发布在 GitHub Releases（见上表）；官网 Worker 只把旧的
  `/download/macos/appcast.xml` 302 过去，不缓存。

首次准备发版机（只需一次；私钥只进入本机 Keychain）：

```bash
swift package --package-path apps/macos resolve
apps/macos/.build/artifacts/sparkle/Sparkle/bin/generate_keys --account app.umuo.desktop
export SPARKLE_PUBLIC_ED_KEY="$(apps/macos/.build/artifacts/sparkle/Sparkle/bin/generate_keys --account app.umuo.desktop -p)"
bun run bundle:macos -- --version X.Y.Z
bun scripts/sparkle-appcast.ts "$PWD/apps/macos/dist" X.Y.Z
```

`generate_keys` 首次会创建签名密钥，需妥善备份。本次代码接入没有创建或读取正式签名密钥。

备份与交给发版流程（私钥只出现在本机的临时文件里，用完即删）：

```bash
bin=apps/macos/.build/artifacts/sparkle/Sparkle/bin
"$bin/generate_keys" --account app.umuo.desktop -x ~/Desktop/umuo-sparkle-private.key  # 导出私钥
# 把这个文件存进密码管理器（1Password 等）作为离线备份
gh variable set SPARKLE_PUBLIC_ED_KEY --body "$("$bin/generate_keys" --account app.umuo.desktop -p)"
gh secret set SPARKLE_PRIVATE_KEY < ~/Desktop/umuo-sparkle-private.key
rm -P ~/Desktop/umuo-sparkle-private.key
```

换电脑时用 `generate_keys --account app.umuo.desktop -f <备份文件>` 导回 Keychain。丢了私钥，已发出去的版本就再也收不到更新。
默认 `sign_update --account app.umuo.desktop` 读专用 Keychain；自动化可用 `SPARKLE_PRIVATE_KEY_PATH` 指向官方导出的私钥文件，
不把私钥放命令参数、日志或仓库。签名后脚本验证包内公钥，阻止误用另一把签名密钥。
Release 工作流使用 repository variable `SPARKLE_PUBLIC_ED_KEY` 与 secret `SPARKLE_PRIVATE_KEY`，后者写入权限 600 的临时文件并在退出时删除。
`release:swift` 会生成 appcast，但不上传。

本机验证：根目录 `bun run verify` 通过（含 370 项 Swift Testing、FFI 自检与带 Sparkle 的签名打包冒烟），
`site/` 的 `bun run verify` 通过（196 项 Vitest 与官网构建）。另用临时 Ed25519 测试密钥、官方 `sign_update` 和真实冒烟更新包
跑通签名、独立公钥验签与 appcast 生成，不访问真实 Keychain；签名错误、篡改包与 XML 版本注入由工具测试拦截。

尚待完成：Developer ID / 公证、真实 N → N+1 安装重启（从 GitHub Releases 下载、验签、替换、重启）。
当前没有进行线上发布，不能将本机代码接入视为上述验收已通过。Homebrew Cask 仍未建立。

官方依据：[程序化接入](https://sparkle-project.org/documentation/programmatic-setup/)、
[手动签名顺序](https://sparkle-project.org/documentation/sandboxing/#code-signing)、
[发布与 appcast](https://sparkle-project.org/documentation/publishing/)。

## 必须守住的兼容性

- Bundle ID 保持 `app.umuo.desktop`，Keychain service 同名、account 为供应商 id；读取旧文件 Keychain，不能切到另一套存储后让 Key 消失。
- `.app` 名 `umuo.app` 与可执行文件名 `umuo-desktop` 不变，旧 LaunchAgent 指向 `…/umuo.app/Contents/MacOS/umuo-desktop`。
- 配置目录仍为 `~/Library/Application Support/app.umuo.desktop`，由 FFI `defaultConfigDir()` 返回。
- `settings.json` 字段与 camelCase 格式不变，只由 Rust 读写；Swift 只提交 patch，保留未知字段。
- 历史沿用 `history.db` 与 `umuo-store` 的迁移；不要更改已发布迁移。
- 默认键位只影响新装，不改写旧用户保存的键位。功能对齐见 `PRD-CONFORMANCE.md`。

## 真机验收与性能待办

自动测试不覆盖用户权限、真实焦点、剪贴板或系统按键，发版前逐项验：

- Safari / 备忘录取词、非激活浮窗、钉住与切走收起；多显示器与 Retina 的定位和拖动。
- 静默替换选区 / 整框，翻译中切换前台时拒绝写回；AX 不可写、原文变化与缺权限时不改内容。
- 输入翻译、原地替换与复制 / 粘贴；Esc 停止对应请求。
- 长文本分片；请求失败（断网、限流、超时）如实报错且不换模型；历史与来源标注正确。
- 截图权限、取消、Vision 空结果；结果朗读、菜单栏快捷面板、自启动。
- Intel 真机启动通用包；DMG 拖装、Gatekeeper、公证、系统权限与升级后的 Keychain 访问。
- macOS 13 明确拒绝启动；正常正式包不出 Dock 图标、默认注册快捷键。
- VoiceOver、完整键盘操作、系统对比度与减少动态效果偏好。

`docs/RELEASE-GATES.md` 的数字来自旧 Tauri 构建，仅作历史基线；原生 release 包须重新测安装包、phys_footprint、CPU、唤起与首字开销。
