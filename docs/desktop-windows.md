# Windows 本地日用客户端

## Goal 与边界

- 任务标识：TASK-WINDOWS-DESKTOP。
- 分支：`codex/windows-desktop`，基于瘦身收口提交 `fc8e5b3`。
- 只做 Windows x64，复用现有 Next standalone 阅读、导入、解读与标注功能。
- 目标是无需用户安装 Node 或手动启动服务的本地日用客户端，不是仅打开远端网页的浏览器壳。
- 书库、设置和对话留在独立可写目录；不打包正式 `data`、`.env` 或模型密钥。
- 暂不加入账号、云同步、本地大模型、商业自动升级，也不同时重写现有阅读 UI。
- 不修改原版渲染、来源校验或权限规则来迎合自动化工具。

## 实施里程碑

### P0：独立工作环境（已完成）

新分支与独立 worktree，不把主工程未提交的 `tsconfig.json` 状态或 `pelican*` 文件带入任务。不接触主工程正式书库，不停止原有 3000 服务。

### P1：桌面启动闭环与兼容性验证（进行中）

- Electron 只管理窗口、单实例与后台生命周期。
- 后台用独立 Node 运行 standalone；`process.execPath` 不切换为 Electron，避免 EPUB/MOBI/UMD 子进程与 SQLite 运行语义发生隐式变化。
- 后台绑定 `127.0.0.1` 的新空闲端口；启动通过随机令牌、协议号和自有 PID 校验，不能误连其他本地服务。
- 窗口 sandbox/contextIsolation 开启，禁用 Node 集成、webview、网页权限、任意新窗口与外站导航。
- 开发验证使用独立 profile 和新书库；正式成品忽略开发环境的路径覆盖。
- 验证健康接口、首页/书库 API、实际桌面页面、关闭后端口释放及自有 worker 清理。

### P2：数据与日用稳定性（待完成）

- 首次启动的数据位置选择和已有书库接入；迁移前检查生成任务、版本、完整性与备份，不直接复制正在写入的 SQLite 文件。
- 迁移必须有审计/回退路径，不删除原书库；失败不冒充成功，也不静默切到空书库。
- 密钥接入 Windows 保护存储，避免明文复制与日志泄露。
- 异常退出、生成中关闭提示、数据库恢复、受限诊断日志、重启与升级保留数据。
- 当前 P1 在 Windows 使用自有父 PID 的整树终止，优先防止遗留解析 worker；正常退出前的任务排空与中断状态处理必须在本阶段补齐，不能把强制退出当成完整日用验收。
- 八格式导入、原版与精读、笔记/标注、解读流式协议、重启持久化回归；不未经授权调用付费模型。

### P3：随包运行时与 Windows 成品（待完成）

- 固定 Node/Electron 版本、校验哈希、保留完整运行依赖与第三方许可。
- 生成可运行/可安装成品，安装目录不可写条件、中文与空格路径、无 Node 环境验证。
- 安装/卸载不能清除书库；升级必须保留数据并执行 schema 兼容检查。
- 未签名内测版必须明确标识；未做的干净 Windows、真实模型与用户交互验收不能写成已通过。

## 开发与测试

新增桌面模块位于 `desktop/`，每个模块有同级测试；业务健康探针的测试位于同级路由目录。桌面 JS 通过独立 strict/checkJs 检查。

```powershell
npm run test:desktop
npm run check:desktop
npx vitest run src/app/api/desktop/health/route.test.ts
```

先使用兼容 Node 构建带桌面健康探针的独立包，然后显式指定三项开发路径和独立 profile：

```powershell
$env:JUDU_DESKTOP_RELEASE_DIR='C:\独立验证\app-core'
$env:JUDU_DESKTOP_NODE_PATH='C:\兼容Node\node.exe'
$env:JUDU_DESKTOP_DATA_DIR='C:\独立验证\library'
$env:JUDU_DESKTOP_PROFILE_DIR='C:\独立验证\profile'
npm run desktop:dev
```

这些是 AI/开发自测参数，不是用户安装步骤，也不代表成品已不依赖开发环境。正式客户端的程序/Node 路径由打包资源决定，数据位置从用户目录初始化。

## 验收记录

本节按实际运行结果更新。P0/P1 不等于整个 Goal 完成，未打包、未迁移、未实际测试的能力保持待验收。

### 2026-10-27：P1 阶段证据（未完成整体验收）

已完成的受控检查：

- Node 24.22.1；桌面 strict/checkJs、应用 TypeScript 与本次相关 ESLint 检查通过。
- 桌面默认单测：16 项通过；真实 Electron 窗口测试 1 项跳过，不能算 GUI 已验收。
- 新增桌面健康路由：7 项通过，包括未启用、缺失/错误令牌、多字节头值与 PID/协议响应检查。
- Windows production standalone 构建通过，工作树候选包内容为 160,762,515 字节、5233 文件；该候选标记为 `fc8e5b3-desktop-p1-working-tree`，不是干净提交版，也不是客户端安装包。
- `build/desktop-p1-release-smoke.json`：隔离端口 3321 的八格式导入、原件字节、标注持久化、Origin 保护及共享测试数据的目录切换/回切通过；3321 已释放；没有调用真实模型。
- `build/desktop-p1-lifecycle.json`：桌面后台管理器在 63360/63416 启动实际 standalone，首页与书库 API 均为 200，导入自造文本后关闭并重启，书籍 ID 不变；两端口重新绑定检查通过，均已释放。
- 新增依赖没有改变基线中已有包的锁定版本。npm audit 的基线和新分支均为 13 项（3 low、1 moderate、6 high、3 critical），没有新增告警；既有告警仍待安全评估，不代表已解决。

未通过或尚未执行的检查：

- 全量 Vitest：404 个测试文件通过、1 个失败、5 个跳过；4706 项通过、2 项失败、7 项跳过。失败均来自 `src/app/api/import/route.test.ts` 的默认 5000ms 超时（PDF 导入与旧 EPUB 懒补建）。原因尚未确认，不能宣称全量通过，也没有提高超时或改写解析器来消除现象。
- Electron 45.0.0 官方 Windows x64 ZIP 的 HEAD 返回 200，但受控 GET 报 `UND_ERR_CONNECT_TIMEOUT`；官方安装器等待十多分钟，临时 ZIP 仍为 0 字节。已停止明确属于本任务的下载器 PID 57624；目前 `node_modules/electron/dist/electron.exe` 不存在。
- 按验证环境异常确认约定，真实桌面窗口相关开发与验收停在环境确认关口；不重启下载，不更换镜像/框架，不关闭校验，也不修改上游依赖或渲染策略。需用户确认 GitHub 大文件下载或代理环境后再继续。
- 安装/卸载、随包 Node、已有正式书库迁移、Windows 密钥保护、生成中退出处理与真实模型均未完成验收，整个 Goal 仍未完成。

保留与提交边界：本阶段只提交已确认的 Goal/计划/证据文档；实现代码仍留在该分支工作区，待窗口环境和失败验证收口后再按功能提交，不用窄范围通过代替完整验收。原项目 3000 服务不重启，不向正式 `data` 执行迁移、清理或写入。
