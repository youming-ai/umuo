# 参与贡献

umuo 以 [MIT](LICENSE) 许可证开源（含官网 `site/`）。欢迎提 Issue 与 Pull Request。

## 许可

提交到本仓库的贡献按 MIT 许可证入站即出站：你提交的代码以与本项目相同的 MIT 许可证授权，不需要另签 CLA。
请只提交你有权以 MIT 授权的代码；复制第三方源码时，按 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) 的规则登记来源与许可。

「umuo」名称与图标不随 MIT 授权。分发修改版时请换用其他名称与图标，避免与官方发行版混淆。

## 开发前

1. 读 [AGENTS.md](AGENTS.md)：分层规则、常用命令与测试约定都在那里，人和 agent 共用。
2. 产品范围以 [docs/PRD.md](docs/PRD.md) 为准；已退出范围的功能（收费与许可证、多模型对比、风格与术语管理等）不接受恢复。
3. 翻译逻辑写在 Rust（`crates/umuo-core`、`crates/umuo-app`），平台能力写在 Swift 宿主；API Key 只进系统 Keychain。

## 提交 PR

- 一个 PR 只做一件事；注释与提交信息用中文（代码标识符用英文），提交信息遵循 conventional commits。
- 提交前在本机跑 `bun run verify` 并全部通过；改了官网时在 `site/` 里另跑 `bun run verify`。在 PR 描述里贴出结果。
- 新功能或修复附带测试；测试不访问真实 Keychain、用户剪贴板、真实模型或投递系统按键。
