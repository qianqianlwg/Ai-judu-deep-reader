# 第三方 MOBI/KF8 候选依赖

更新日期：2026-09-20

- 包：`@lingo-reader/mobi-parser`
- 固定版本：`0.4.6`
- 分发包许可：MIT，版权声明见本地安装包 `LICENSE`（hhk-png，2024）。
- 当前身份：**仅开发评估依赖，未作为生产导入能力发布**。MOBI/AZW/AZW3 上传仍明确拒绝，不能通过扩展名开启候选解析。
- 包的 README 表明实现基于 Foliate 的 MOBI 代码；本项目没有为此次评估修改上游包或将候选资源作为不受检查的 HTML 加载。
- HTML 投影使用直接固定开发依赖 `parse5@8.0.1`（MIT，许可证随安装包保留），不创建浏览器 DOM、不加载图片/链接。所有解析与清洗都在可终止的 worker 中，不把高耗时 HTML 正则留在父进程。
- 调用：独立 Node 进程内动态 import 包的 ESM 入口；不使用该包 CommonJS 条件导出的 `.js` 文件来冒充 ESM。
- 第三方同步解压/写资源只在候选子进程中发生；父进程控制截止时间、取消、IPC 验证和临时目录清理。原文件不上传第三方，书籍 HTML 不执行。

## 尚不采纳为生产方案的证据

2026-09-20：合法无 EXTH 的合成 MOBI 暴露 `boundary` 访问错误；固定版本 libmobi 仓库的 3 个真正双格式 KF8 测试样本均在候选 `Kf8.innerInit` 阶段越界。详见 `reader-mobi-verification.md`。不能因为一个普通 MOBI 能解析就推广到 AZW3/KF8。

## 固定上游样本说明

本地评估使用 `bfabiszewski/libmobi` commit `906274205c11944b628da1c553b255acb1af7c55` 的四个 `tests/samples` 文件。仓库根 COPYING 是 LGPLv3；本轮只在忽略目录中本地测试，没有复制库实现或分发样本。将来需要提交样本时应先单独核验各文件的来源与分发许可，不能仅用仓库根许可推断所有电子书内容可重新发布。

升级或替换解析器时，必须重新执行真实容器、坏文件、原件往返、来源定位、资源安全、lint、严格类型、全量回归和生产构建；未经验证不直接更新白名单。

补丁生成器：`scripts/vendor-mobi.mjs`；固定来源与补丁列表见 `vendor/mobi/PROVENANCE.json`。
