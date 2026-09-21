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

- EPUB、PDF、MOBI、FB2/FBZ（含 `.fb2.zip`）、TXT/Markdown 导入，书籍、版本、章节和段落持久化到 SQLite，并保留版本绑定的原件。MOBI 当前只开放 `.mobi`；FBZ只接收单一FB2正文容器，不猜多文档归档。
- 双轨阅读：精读文本分页；PDF使用本地PDF.js原页与文字层；EPUB/MOBI/FB2使用Foliate原生分页候选。概念、句读历史和引用浮窗复用同一设计。PDF引用当前是目标页概览，不等于精确脚注定位。
- 连续多段/跨页选文合计最多1000个Unicode字符，原生可见选区也限制到上限，超限请求拒绝，不自动拆成多次句读。
- 精读的全书分页按浏览器实际排版测量；阅读锚点使用段落 ID + UTF-16 字符偏移，字号及窗口尺寸变化不重写原锚点。
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
- 不含扫描 PDF OCR、章节级批量异步句读、知识包或语音。扫描PDF及图片型FB2可看原版，但没有文字来源就不开放伪文字句读。
- EPUB/MOBI 的 Foliate 原版通路已在本机 Chrome 153（非 Codex 内置浏览器）完成真实页面验收；Codex 内置浏览器仍会让 blob iframe 停在 `about:blank`，最小对照页已证明这是工具环境限制，不应据此修改产品的 blob、shadow root、sandbox 或 CSP。FB2 的独立验收边界见 `docs/reader-fb2-verification.md`。
- `.mobi` 已开放文本导入、原件保存、受控布局和 Foliate 原版阅读，并在本机 Chrome 完成加载、翻页、目录、切书恢复、原版选区和 1000 字上限验收；完整复杂版式矩阵仍是明确边界。AZW/AZW3 仍未开放，UMD 等其他候选不能按扩展名推定已支持。CBZ 已实现图片原版，但没有 OCR 和文字句读。
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

## 私有解析运行时的构建与部署

- `npm run dev`、`npm test`、`npm run build` 会先执行 `npm run build:mobi-worker`，生成不经 HTTP 发布的 `runtime/mobi`。该目录是构建产物，不提交 Git。
- 生产运行不从 `src` 或开发依赖目录动态加载 MOBI parser；部署需携带生成的 worker、清单和第三方许可。Next 导入路由的文件追踪已显式包含这三项。仅安装生产依赖时，应使用先前构建生成的运行时，而不是在启动时临时安装解析开发包。
- `node --test scripts/build-mobi-worker.test.mjs` 验证可复现构建和许可，`src/lib/mobi-worker-deployment.test.ts` 验证独立目录真实子进程运行。直接调用 Vitest 前需先构建运行时，常规 `npm test` 会自动完成。
- `.mobi` 导入、原件保存、受控布局 API 与 Foliate 原版阅读已开放，并已通过本机 Chrome 实机验收；AZW/AZW3 仍返回 415。完整复杂版式矩阵及 UMD 转换尚未交付，不能把 `.mobi` 的通过泛化为整个格式家族完整支持。

### UMD候选转换

- 新增严格文字型UMD解析、受限独立进程和EPUB转换候选；精读正文直接来自同一UMD解码快照，原件与派生EPUB分别计算哈希。
- `npm run build:umd-worker`生成私有`runtime/umd`；常规开发/测试/构建前置脚本会同时生成MOBI和UMD运行时。
- `.umd`仍不开放上传：还缺真实文件兼容性、漫画/混合型、原件与转换版本双份持久化和浏览器验收，不能以候选转换通过当作完整支持。
