# 句读 · Judu Reader

面向经典原著和高密度文本的桌面 Web 阅读器。AI 依附于原文，帮助理解而不是替代阅读。

## 本地运行

需要 Node.js 22.13 或以上版本（使用内置 SQLite；推荐 Node.js 24）。

~~~sh
npm ci
npm run dev -- --port 3000
~~~

打开本地 3000 端口。在「设置」填写协议（OpenAI Chat Completions / Claude Messages）、服务 URL、模型和 Key，然后测试连接。Key 只保存在本地数据库或服务端环境中，不返回完整值给页面。当前以单用户本机环境为边界，不应直接暴露到公网。

## 当前能力

- EPUB、文字型 PDF、TXT/Markdown 导入，书籍、版本、章节和段落持久化到 SQLite。
- 全书分页按浏览器实际排版测量；阅读锚点使用段落 ID + UTF-16 字符偏移，字号及窗口尺寸变化不重写原锚点。
- LangChain Agent + OpenAI Chat Completions / Claude Messages 双协议；普通正文流式显示，结构化句读经工具校验保存，不从正文解析 JSON。
- 左侧书架、知识库工作台；同一本书可新建、切换和重命名多个会话；右侧保留聊天与 Token 用量。
- 重试复用原消息 ID，支持停止生成、保存失败状态和刷新恢复。
- 句读文本按精简/标准/详细三档生成；正文句读使用虚线下划线，概念词使用浅黄色半标亮，句末历史图标独立占位。
- 本书知识卡片：概念、历次句读、原文及对话定位；缺少准确锚点的旧记录明确禁用跳转。
- 本书关键词搜索；可选 PostgreSQL/pgvector 查询适配、RRF 融合及检索状态展示。
- Agent 运行日志记录请求、工具开始/完成/失败、审计失败和最终错误；日志会脱敏，不记录 API Key。

## 仍需明确的边界

- **默认没有启用向量检索。** 当前书籍导入写入 SQLite，尚无自动 embedding 生成及全书入索引流程。迁移 SQL / 查询适配的存在不等于已建好向量；未配置 PostgreSQL 时显示关键词回退。不能将契约测试通过当作真实 pgvector 环境已验证。
- 上下文设置提供 **200K、400K、1M** 三档输入预算；模型工具生成阅读记忆、按 Token 分批并保存检查点，不按最近条数或消息比例截取。新消息追加在检查点之后，显式调整预算可原位重试。**并非 Codex 内部压缩服务的一比一实现**。
- 不含扫描 PDF OCR、章节级批量异步句读、知识包或语音。
- 模型在原文中没有逐字出现的概念名称不会被强行标注；只有已保存且属于当前版本的概念参与匹配。

## 测试与隔离验证

~~~sh
npm test
npm run lint
npx tsc --noEmit
npm run build
~~~

可将 EPUB_FIXTURE_DIR 指向自己有权使用的本地 EPUB 文件目录，运行真实书籍解析回归；默认测试不依赖个人下载目录，也不提交书籍文件。

新功能必须按 AGENTS.md 使用独立端口及独立 NEXT_DIST_DIR 验证。JUDU_DATA_DIR 可指定独立 SQLite 数据目录，避免测试污染用户书架。测试资料、Key、数据库和临时构建均不进入 Git。

业务模块位于 src/lib，UI 在 src/components，运行装配在 src/app 和 src/hooks。数据库迁移见 db/migrations。开发与提交规范见 AGENTS.md。

## 第四阶段文档

工具入参/出参及保存边界见 docs/agent-tools.md；本机范围的最终验收证据、主库切换与部署边界见 docs/stage4-verification.md。

业务 API 默认限制本机 Host、同源来源和写请求内容类型。若部署到其他域名，须配置 JUDU_APP_ORIGIN，并另行配置认证与 HTTPS；这不是现成的多用户公网部署方案。
