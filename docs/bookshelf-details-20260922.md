# 书架独立信息面板改造（2026-09-22）

## 范围与决策

- 只改书架与重复书籍导航；未改阅读入口语义、正文渲染、分页、进度存储或AI链路。
- 移除侧栏各视图的“我的书籍”树及书架说明；阅读目录和书内搜索保留。
- 书卡的更多操作改为小型浮层，提供书籍信息、文件与版本、管理三个入口，不在卡片下面铺开维护表单。
- 书籍信息使用原生dialog顶层侧面板；桌面宽度460px、窄屏全宽、独立滚动、底部阅读按钮固定在面板布局中。
- selectedBook与当前阅读book分离，查看信息不更新最近阅读、不加载正文；明确点击阅读才使用BookID/EditionID打开对应版本。
- 信息顺序：封面/书名/作者优先，概览显示已知位置；文件与版本保留准确身份，ID折叠到技术信息；管理集中改名、封面重试和下架。
- 保留原有下架确认、错误反馈、忙碌禁用和数据保留约定。关闭面板返回触发按钮焦点。
- 无新增依赖，无数据库迁移，无正式书籍/设置/标注/原件修改。

## 自动化与API验证

- 全量测试：236个测试文件通过、3个跳过；3641项通过、4项条件跳过。
- 全量首次与构建并行时，PDF导入测试触发默认5秒超时；停止并行构建后以maxWorkers=4重新运行全量通过，没有延长测试超时或改导入实现。
- 新增面板测试和更新书架、菜单、侧栏及真实页面集成测试，覆盖查看不切书、独立版本、关闭/Escape/焦点、忙碌保护、保存/下架错误和成功回调。
- TypeScript严格检查、改动文件ESLint和生产构建通过；构建输出仍有custom-highlight CSS和动态模块追踪警告，未为压警告修改阅读渲染。
- 端口3295、构建目录.next-verify-shelf-panel-20260922、数据目录.verify-shelf-panel-20260922；正式SQLite以backup快照复制，仅在本机验证。
- 隔离首页与/api/library返回200，5本原记录均在，三个有原件的封面接口返回200。
- 第一轮临时端口3295已释放。后续确认与主项目交付状态见下方。

## 第一轮视觉验收：暂停并请求环境确认（后续已复核）

- 已看到书架网格、真实封面和小型更多菜单；独立面板能出现在DOM中，含概览/文件与版本/管理与关闭按钮。
- CUA请求1280×900 viewport后，页面报告innerWidth=1910、innerHeight=1343；截图右侧/下方空白，面板像素未正常呈现。
- 已恢复viewport默认值，但只保存现场证据，未继续宣称视觉通过。原因未确定，不能直接归为产品缺陷或断言只是工具问题。
- 现场截图：.verify-shelf-panel-20260922/screenshot-pending-review.png。
- 按AGENTS约定暂停相关视觉验收；没有改安全策略、上游shadow root、文档运输或替换原生dialog绕过工具。
- 待用户确认内置浏览器缩放/裁切后，需继续桌面与窄屏、面板滚轮、关闭/焦点、版本/管理视觉检查；全部通过再启动主项目默认.next/data/3000验收。

## 日志

- .verify-shelf-panel-all-tests-serial-build.log
- .verify-shelf-panel-tsc-final.log
- .verify-shelf-panel-lint.log
- .verify-shelf-panel-build.log
- .verify-shelf-panel-server.log


## 环境确认后的复核与交付

- 用户确认自己的界面没有右侧留白/裁切。未将该反馈直接等同于新版产品通过，而是重新做隔离与主项目验证。
- 复核隔离端口3296使用同一生产构建和书库快照：localhost的浏览器报告devicePixelRatio约0.67；在未继承该站点缩放状态的127.0.0.1地址下，devicePixelRatio为1、实际窗口1280×720，截图完整。相同产品代码、相同服务、相同数据，无渲染兼容补丁。
- 默认桌面截图通过：书籍详情完整显示，独立圆角面板未挤压书卡；概览、文件与版本和管理分区均可操作。
- 滚轮验证：管理区scrollTop由0到265，可见下方封面重试与下架操作，底部阅读按钮保持可达。
- Escape关闭后dialog数量归零，焦点回到所选书卡“更多操作”；列表、EPUB筛选和准确版本入口通过。
- 真正390×844窄屏通过：innerWidth=390、documentElement.scrollWidth=390；详情rect为0,0,390,844，没有横向溢出。已恢复viewport默认值。
- 主项目重新构建并启动：默认.next、正式data、3000端口，首页与/api/library均200，仍有5本书。
- 主项目截图经同一3000服务的本机地址取得（避免localhost缩放对截图接口的影响），不是隔离书库交付。用户原localhost:3000标签已刷新到新版，5个书卡菜单存在，旧内嵌详情和侧栏书树为0。
- 正式SQLite全部18张表在重启与验证前后的行数和内容摘要一致；未在正式数据上测试改名或下架。
- 两个临时端口3295/3296均已释放；主项目3000继续运行。
- 本轮未调整用户localhost的缩放偏好、系统设置或任何安全策略。

### 复核截图与日志

- .verify-shelf-panel-20260922/main-bookshelf-grid.png
- .verify-shelf-panel-20260922/main-book-details.png
- .verify-shelf-panel-20260922/verified-details-mobile.png
- .verify-shelf-panel-20260922/verified-bookshelf-list.png
- .verify-shelf-panel-20260922/formal-integrity-result.json
- .main-bookshelf-details-build.log
- .main-bookshelf-details-server.log
