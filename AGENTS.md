<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## AI 开发约定

- 每个文件原则上不超过 500 行；超过时按职责拆分。
- 模块按职责组织；组合根集中负责运行时装配，不在业务模块中隐式组装依赖。
- 新增模块必须在同级目录同时新增测试。
- TypeScript 必须使用严格类型检查，避免 `any`；必要的运行时边界使用显式类型守卫。
- IO 操作优先使用异步 API；只有数据库事务等明确需要同步语义的操作才可使用同步 API，并在代码中说明原因。
- 异常必须记录或上抛，不能静默吞掉；用户可恢复的错误要有明确界面反馈。
- 关键设计决策使用中文 `// WHY：` 注释说明原因。
- commit message 使用中文，并包含测试说明、决策和 Task footer：

```text
feat(web): 增加阅读器能力

开发详情：...

测试：单元测试 + 集成测试
- 单元测试：...
- 集成测试：...

被否决：...
决策：...

Task: TASK-xxx
Assisted-by: Codex
```

## 本地端口验证约定

- 添加新功能或进行重要改动时，必须自行启动一个新的未占用端口进行验证，不得直接占用主项目当前端口。
- 验证前先确认新端口服务启动成功，并通过页面或 API 完成实际验证。
- 验证失败时继续在隔离端口排查，不影响主项目运行。
- 验证成功后释放临时验证端口；如需继续开发，可由主项目重新启动并使用约定的主端口。
- 最终反馈必须说明：验证端口、验证结果、是否已释放端口，以及主项目是否已重启。
