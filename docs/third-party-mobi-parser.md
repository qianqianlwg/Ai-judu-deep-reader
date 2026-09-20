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

## 2026-09-20 布局捕获后续

新增布局worker模式保留不可信head/HTML/CSS/资源，仍未作为浏览器输入或生产上传能力。新增可复现补丁：资源写入预算与wx、封面offset0、可选recindex图片、保留head、稳定包内资源ID和按HTML/CSS语义改写引用。补丁与固定源码/许可记录在PROVENANCE；没有改变上游版本，也没有把图片、字体扩展名当内容安全证明。

私有worker新增打包既有CSS Tree 3.2.1（MIT，Roman Dvornov），源码与许可对照 `public/vendor/foliate/PROVENANCE.json` 核验；完整许可进入私有THIRD_PARTY_NOTICES，不依赖生产机器安装开发包。原text模式、仅runtime部署及四个固定样本继续回归。资源和定位的已验证范围/未完成边界见 `reader-mobi-verification.md` 最新批次。

## 2026-09-20 来源字节接口与HTML位置解码

- 可复现补丁清单增加 `source-byte-ranges`。`getSourceChapter` 返回原始来源字节副本、encoding与MOBI fileStart/KF8 spans；KF8正文渲染和来源使用同一重建算法。原包源码SHA和MIT许可未改变。
- 新内部快照为 `mobi-layout-untrusted-v2`：只把严格字节来源、UTF16源码位置、DOM节点和正文结构签名共同证明的点标成 `exact-source`；不接受旧v1唯一selector作为精确来源。资源捕获/属性改写不等于净化，上传仍415。
- HTML实体边界直接使用此前安装/锁定的 `entities@8.1.0`，从传递依赖提升为精确直接devDependency；lock只新增根声明。离线安装命令因本地registry元数据未命中而失败后，没有更换版本或联网升级依赖。其许可仍由私有运行时打包清单自动收录。
- `parse5`保留sourceCodeLocation，按body childNodes索引定位，签名含命名空间/标签/文本/节点顺序，不把资源属性变化当正文变化。隐藏区域、非HTML内容和不完整实体/UTF8/代理对保持不支持，不执行脚本或加载网络资源。
- 本机Node22.22.0/ICU77.1的windows-1252 C1解码异常已报告待环境确认，未加入fallback。真实样本的部分目录仍未证实，禁止把内部候选或现有测试结果宣传为完整MOBI/AZW/AZW3支持。详见 `reader-mobi-verification.md` 最新批次。

## 2026-09-20 正文窗口与资源来源补丁

固定补丁新增 `source-body-projection` 与 `resource-provenance`。vendor和来源构建共享按parse5实际语法得到的body窗口；MOBI6旧属性转换不再使用匹配标签的正则，KF8继续使用已有HTML/CSS语义资源改写。`getResourceAliases`只导出本次实际缓存映射，由worker核对目标确实属于已捕获资源；不返回磁盘路径或可执行渲染许可。

内部协议v3加入章节HTML hash绑定以及worker目标语义复核，资源转换之前/之后的节点属性不能无条件忽略。Parser关闭hook使用已固定parse5内部行为，预算、边界及可复现vendor测试均是升级门禁。body窗口同时保留已知根容器隐藏语义，不能在裁掉容器后开放原隐藏内容的定位。

四个固定样本的11个内部目标已逐点核验；不扩张为完整AZW/AZW3、CP1252 C1或安全渲染支持。许可与依赖版本未改变，样本仍只用于本地验证，不进入仓库。验收和剩余范围见 `reader-mobi-verification.md` 最新小节。
