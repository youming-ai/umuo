# 安全策略 · Security Policy

## 报告漏洞

**请不要用公开 Issue 报告安全漏洞。** 在仓库的 Security 页面用 GitHub 的私密漏洞报告提交：
<https://github.com/youming-ai/umuo/security/advisories/new>

请尽量写清：受影响的版本（「设置 › 关于」里的版本号）、macOS 版本、复现步骤与影响。
报告里**不要附真实的 API Key**；需要演示时用作废的 Key 或本地桩。

我们会尽快确认收到并评估；修复随下一个正式版发布（客户端改动合入 `main` 即自动发版），确认后在 Security Advisory 里公开说明并致谢（如你愿意）。

**Please do not report security vulnerabilities through public issues.** Use GitHub private vulnerability reporting at the link above.
Include the affected version, macOS version, reproduction steps and impact, and never include a real API key.

## 范围

特别关心这些方面：

- API Key 的存储与使用：Key 只应存在系统 Keychain，不应出现在配置文件、日志、历史库、界面或网络请求的非预期位置。
- 辅助功能权限下的取词与写回：读到或写入不该碰的内容（如密码框）、误改用户剪贴板。
- 自动更新：Sparkle 更新包与 appcast 的验签。
- 代码签名：正式包目前用自签名证书并关闭了库校验（`disable-library-validation`），未经 Apple 公证；
  利用这一点的注入方式欢迎报告，背景见 [docs/SWIFTUI-MIGRATION.md](docs/SWIFTUI-MIGRATION.md)。
- 官网 Worker（`site/`）。

不在范围内：你自己配置的模型供应商端点本身的安全问题；需要已获得本机管理员权限或物理接触才能利用的问题（除非它绕过了 macOS 的权限保护）。

## 支持的版本

只修最新的正式版（GitHub Releases 上标为 Latest 的版本）。已安装的应用可在「设置 › 关于」里检查更新。
