# SwiftUI 迁移与发布记录

> 2026-10-22 用户要求清理旧实现。当前唯一客户端是 Swift + SwiftUI + AppKit，最低 macOS 14。
> Rust 翻译内核、应用逻辑与 SQLite 保留，经 UniFFI 调用。
> 旧源码清理已完成；SwiftUI 版正式发布、应用内更新与真机验收仍未完成。

## 阶段状态

| 阶段 | 状态与证据 |
| --- | --- |
| 0 UniFFI 链路 | ✅ `umuo-ffi`、`build-core.sh` 与 Swift `--selftest` |
| 1 共享应用逻辑与导出 | ✅ `umuo-app` 保存编排逻辑，Engine 导出翻译、对比、设置、历史、术语表、用量等；流水线回归迁到 `crates/umuo-app/tests/pipeline.rs` |
| 2 Swift 平台层 | ✅ AX 取词与写回、Keychain、剪贴板降级、Carbon 组合键、CGEventTap 连按、系统框选、Vision OCR、语音、LaunchAgent 均在 `Platform/`；真实系统权限与焦点仍需验收 |
| 3 原生窗口 | ✅ 浮窗、设置、撰写、对比、历史、首次引导、菜单栏快捷面板及 Swift Testing 已实现；见 `Sources/Umuo/` 与 `Tests/UmuoTests/` |
| 4 收费许可证 | ⏸ 用户暂缓，不在客户端加许可证或付费门控 |
| 5 打包与分发 | 🟡 通用 `.app`、`.dmg`、`.app.tar.gz` 与本机打包冒烟已实现；Developer ID / 公证、应用内更新、Homebrew Cask 待完成 |
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
现有 `Theme/Palette.swift` 保留自定义主题；原生控件、VoiceOver、键盘导航、减少动态效果与提高对比度须继续真机走查。
删除旧 CSS 不代表已经完成所有视觉规范对齐。

只装 Command Line Tools 也能构建：

- Swift Testing 的 TestingMacros 由 `verify.sh` 自动查找并传入工具链插件路径；完整 Xcode 无需绕行。
- CLT 缺少 xcstringstool，因此整个 `Resources/Strings` 目录原样复制，`L10n.swift` 运行时读取 String Catalog。
  后续文案直接改 `Localizable.xcstrings`，旧 TS 文案导出脚本已删除。
- 资源包放在 `.app/Contents/Resources`；打包脚本校验 Bundle ID、资源位置、签名和二进制架构，并从包内跑 selftest。
- 图标生成直接写入 `packaging/icon.icns` 与 `Resources/Tray`，不再依赖旧客户端目录。

## 阶段 5：打包与发布

`bun run bundle:macos -- --version X.Y.Z` 只产出文件，不上传。
脚本分别构建 arm64 与 x86_64 的 Rust 静态库和 Swift release 二进制，独立 scratch 目录后 lipo 成通用二进制。
以 macOS 14 为部署目标，组装 `.app`，由内向外签名；无 Developer ID 时使用 ad-hoc。
`APPLE_SIGNING_IDENTITY` 配置签名身份；`APPLE_API_KEY`、`APPLE_API_ISSUER`、`APPLE_API_KEY_PATH` 同时存在时调用 notarytool 并 staple。
`bundle.sh --quick` 复用本机 debug 产物，只做 ad-hoc，不公证、不生成 DMG，供离线门禁使用。

Actions → Release 手动输入版本号，只构建并保存原生安装包 artifact，不上传 R2；合入 main 不发布。
GitHub Actions 目前因账单问题不可用，先在本机跑 `bun run verify`。
旧 `release:local` 和 Tauri 构建工作流已删除，不再产出旧客户端。

### 旧用户更新桥接

`bun run release:swift X.Y.Z` 在干净、与 origin/main 一致的 main 上跑门禁，构建 Swift 通用包与旧通道签名，
在 `apps/macos/dist` 生成 `update.json` / `latest.json`，默认不上传。
显式 `--publish` 才按「DMG、更新包、update.json、latest.json」顺序传 R2，避免清单指向未传完的文件。
上传使用 `site/` 已有的 Wrangler 配置与登录态；此处只记录现有发布脚本，不部署官网。

旧用户的 Tauri Updater 验 minisign 签名、替换安装目录，再按新 Info.plist 重启，因此可以接收 Swift 包。
仅 `--updater-sign` 显式请求时运行固定版本 `@tauri-apps/cli@2.12.1` 的 signer；它不再是项目依赖，也不构建旧客户端。
私钥仍通过环境变量或本机私钥文件读取，不输出；环境变量名保留 `TAURI_SIGNING_PRIVATE_KEY` / `_PATH` 以兼容已有发版机。

**桥接发布前必须满足：**

1. 先接上并实测 Swift 自己的应用内更新（计划 Sparkle）。现在「检查更新」仍为占位，不能把旧用户迁到无法继续更新的版本。
2. 取得 Developer ID 并完成签名、公证与 Gatekeeper 验收。ad-hoc 每次更新会改变 cdhash，用户可能需要重新授权 TCC 与 Keychain。
3. 明确最低系统版本变化：Swift 要 macOS 14+，旧 Tauri 版支持更早系统，旧更新器不看最低系统版本。
   不接受让旧系统用户收到无法启动的更新时，保留线上旧 update.json，仅发布官网直装版。
   当前发布脚本仍要求显式 `ACK_MIN_OS_14=1`；该变量不代替应用内更新与签名验收。
4. 用测试密钥与本地更新清单走完一次旧版下载、验签、替换、重启到 Swift 的流程；保留旧用户的配置、历史、Key 与登录项。

### 应用内更新待办

Sparkle 尚未接入。需要集成 SwiftPM 框架、由内向外签名嵌套组件、配置独立 EdDSA 公钥与 appcast，
把菜单和关于页的占位接上，并实测从 N 到 N+1。Sparkle 密钥与旧通道 minisign 密钥是两套。
旧 `update.json` 留给尚未迁移的用户，Swift appcast 与它并存；先验证原生更新，再发布桥接包。
Homebrew Cask 尚未建立。

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
- 撰写防抖、回译与复制 / 粘贴；对比成功失败各落自己的卡片，Esc 停止对应请求。
- 超额切供应商、断网回落本机模型、长文本分片；历史、费用与来源标注正确。
- 截图权限、取消、Vision 空结果；语音与菜单栏样式、快捷面板、自启动。
- Intel 真机启动通用包；DMG 拖装、Gatekeeper、公证、系统权限与升级后的 Keychain 访问。
- macOS 13 明确拒绝启动；正常正式包不出 Dock 图标、默认注册快捷键。
- VoiceOver、完整键盘操作、系统对比度与减少动态效果偏好。

`docs/RELEASE-GATES.md` 的数字来自旧 Tauri 构建，仅作历史基线；原生 release 包须重新测安装包、phys_footprint、CPU、唤起与首字开销。
