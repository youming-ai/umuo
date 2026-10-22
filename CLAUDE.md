# CLAUDE.md

本仓库的 agent 指令统一放在 **[AGENTS.md](AGENTS.md)**，此处不再重复一份（重复必然漂移）。

请直接阅读 `AGENTS.md`：项目定位、分层规则、常用命令、测试约定、明确不要做的事都在那里。

三个最容易踩的点，先记住：

1. **翻译逻辑在 Rust**（内核 `crates/umuo-core`，编排 `crates/umuo-app`），不在 TypeScript 或 Swift 里；改完跑 `bun run test:rust`。
2. **API Key 不能出现在前端、日志、配置文件或历史库里**——走系统 Keychain。
3. **不要做浏览器扩展**（PRD §3.3 明确列为非目标）。
