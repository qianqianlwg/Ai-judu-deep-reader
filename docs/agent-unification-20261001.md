# 统一句读 Agent 与工具协议（2026-10-01）

本文件描述本次合并后的运行规则；此前的 agent-audit-20261001 目录是改造前审计快照，不作为当前协议。

## 1. 只保留两个业务 Agent

### 句读主 Agent

负责逐句/逐段细读、整段释读、普通追问、书内与授权外部检索、原文/正文标注，以及句读完成后的综合小结。

- 有已核验原文锚点的句读请求统一进入主 Agent，不再启动旧式规划或独立小结 Agent。
- 同一对话先逐次提交 submit_reading_sentence；每次来源与标注校验、事务保存成功后立刻推送前端。
- 每次只处理当前句。默认按句意；whole 模式按自然段释读。不得跳过、重复或先交整份分块计划。
- 界面先显示“正在思考”，不展示内部思考；工具调用开始后显示当前句占位，成功后替换为正式句读。
- 全部覆盖后保留原工具对话，将可用工具切换为空，直接输出一至三段综合小结，不额外调用一个小结 Agent。
- 普通追问直接回答；必须由 Agent 在完整正文之后提交 mark_answer_emphasis。正常结束但漏交时，同一 Agent 最多获得两次补交机会，只提交重点，不改写或重复正文。
- 截断、拒绝、流提前结束不作为正常完成；失败保留此前成功的句读和标注。
- 无已核验锚点时可以解释和标注回答，但不编造原文位置或创建原文句读块。

### 思维导图 Agent

只依据主 Agent 已完成的真实释读，增量整理当前完整导图；只有 update_reading_guide 一个工具。

- 主 Agent 尚在生成且父任务租约有效时，不提前消费其逐句来源。
- 同书已完成的逐句来源和独立旧式历史来源一起领取，按完整输入容量合批，最多 64 则/批；不截断释读或伪造摘要来塞进窗口。
- 输入包含完整当前框架、本批全部释读、实际提示词和工具 Schema。
- 每则本批来源必须出现在修改后导图节点的 sourceIds 中。无须新主题时合入已有节点，不把遗漏的来源标记完成。
- 同书独占租约、过期恢复、来源独立重试预算、版本冲突保护和事务提交继续保留。
- 容量不足或来源分析缺失会明确失败，保留已有导图，不声称“全部已整理”。

## 2. 统一长度与解读方式

长度比例按每句/每块对应原文与其释读正文的 Unicode 字符数计算，不计标题、原文引用、工具元数据，综合小结不再重复套比例。

| 参数 | 名称 | 默认比例 | 表达要求 |
| --- | --- | --- | --- |
| gist | 大意 | 15%–30% | 只保留核心意思 |
| concise | 简短 | 40%–65% | 保留必要关系 |
| standard | 正常 | 80%–110% | 完整、忠实解释 |
| detailed | 详细 | 130%–170% | 补充关键关系与必要背景 |
| expanded | 展开 | 180%–240% | 提供有帮助的例子、区别、推导 |

这是表达目标，不是拒绝保存、取消任务或最大输出 Token 的硬限制。短句以说明原意为先，不为比例凑字；当前用户的明确要求优先。追问只沿用长短倾向，不机械按历史选文字数计算。

| 参数 | 名称 | 解读要求 |
| --- | --- | --- |
| beginner | 小白 | 补齐必要基础，解释术语，用具体例子；不牺牲准确性 |
| accessible | 通俗 | 日常语言，减少术语并随文解释 |
| normal | 正常 | 易懂与准确兼顾，保留必要术语 |
| advanced | 深入 | 概念边界、论证关系与易混区别，不堆砌专业词 |

解读方式和回复长度独立：通俗不等于简短，深入不等于冗长。

## 3. 主 Agent 工具与参数

工具描述均包含有效参数示例；示例中的来源 ID 必须替换为本轮真实返回值。

### submit_reading_sentence（仅有核验来源的句读任务）

所有顶层字段、sourceAnnotations 和 answerEmphasis 的子字段均必填：

| 参数 | 用途与校验 |
| --- | --- |
| sourceStart | 当前句原文首部，通常 5–8 字符，最多 8；保留空白标点，短句不足 5 字用全文 |
| sourceEnd | 当前句原文尾部，通常 5–8 字符；匹配歧义时加长，最多 160；不做模糊匹配 |
| title | 本句小标题，1–120 字符；无整组 listTitle |
| content | 本句释读正文，不是用于定位的原文副本；自然中文 Markdown |
| sourceAnnotations.keywords | none 或 1–16 项，每项 paragraphKey、quote；quote 1–1000 字符 |
| sourceAnnotations.keySentences | none 或 1–16 项，每项 paragraphKey、quote；quote 1–1000 字符 |
| sourceAnnotations.concepts | none 或 1–20 项，每项 paragraphKey、name、text；name 1–80、text 1–2000 字符 |
| answerEmphasis.keywords | none 或 1–16 个正文逐字引用，每项 1–1000 字符 |
| answerEmphasis.keySentences | none 或 1–16 个正文逐字引用，每项 1–1000 字符 |

paragraphKey 是本轮 target 提供的 6–9 字符短别名，如 p000001；不是数据库 UUID，不允许模型猜测。原文关键词、关键句和概念名称必须逐字位于当前句实际覆盖的段落。正文重点必须位于 content 的可标注正文。

重复重点按第一次匹配定位；同类重叠拒绝，关键词与关键句跨类别可以重叠。没有重点的字段显式填写字符串 none，不省略、不传空数组。工具不接收 occurrence、kind、marks、version 或 listTitle；旧存储中的字段只做历史兼容。

示例（target 原文为“劳动形成价值。”，paragraphKey=p000001）：

~~~json
{
  "sourceStart": "劳动形成价",
  "sourceEnd": "劳动形成价值。",
  "title": "劳动与价值",
  "content": "劳动形成商品的价值。",
  "sourceAnnotations": {
    "keywords": [{"paragraphKey": "p000001", "quote": "劳动"}],
    "keySentences": "none",
    "concepts": "none"
  },
  "answerEmphasis": {"keywords": ["劳动"], "keySentences": "none"}
}
~~~

回执提供 ok、已完成数、剩余字数、nextSourceStart、allCovered；失败反馈具体字段与来源位置，不再统一掩盖为“所有字段必填”。同一句连续三次失败停止，并保留已完成内容。

### mark_answer_emphasis（普通追问或无核验锚点的回答）

唯一顶层参数 answerEmphasis，结构与上文完全相同。正文先完整输出，再调用工具。例：

~~~json
{"answerEmphasis":{"keywords":["劳动"],"keySentences":"none"}}
~~~

### search_book / read_source（书内检索）

- search_book：query 为 1–500 字符；additionalQueries 可选、最多两个各 1–500 字符；mode 可选 auto/keyword/semantic/hybrid；chapterId 默认为 null；limit 为 1–8，默认 5。
- 示例：{"query":"相对价值形式","additionalQueries":["等价形式"],"mode":"auto","chapterId":null,"limit":5}。
- read_source：sourceId 为本轮真实已提供来源，1–240 字符；neighbors 为 0–2，默认 1。示例：{"sourceId":"book:edition:paragraph:p1","neighbors":1}。
- 权限和证据范围由服务端绑定，不访问其他书籍，不用相邻片段拼接虚构引文。检索失败/空结果不能证明全书不存在相应论点。

### 外部工具（按用户授权与可用性装配）

- search_openalex：学术书目元数据，不等于阅读论文全文。
- verify_crossref：核验 DOI、标题及出版元数据，不当作全文论证。
- search_web：网页检索片段，不等于全文。
- 上述三个均只接收 query，2–120 字符的简短主题词或 DOI；不得外发选文、笔记、聊天全文或个人信息。例：{"query":"commodity value form"}。
- read_external_source：只接收本轮实际已登记的 OpenAlex/Web sourceId，格式 external:openalex/web:24位小写十六进制哈希；不接收任意网址。例：{"sourceId":"external:web:0123456789abcdef01234567"}。
- 没有用户授权或来源服务不可用时不绑定相应工具；外部观点比较前须读取实际正文，不能推断未读取内容。

save_reading_analysis 仅保留为历史协议适配，不绑定当前主 Agent；compress_context 不再是 Agent 工具。

## 4. 思维导图工具

update_reading_guide 参数：

- reason：1–600 字符的中文修改说明。
- upserts：0–200 个完整节点；节点包含 id、parentId、title、summary、sourceIds，可带 position。
- 新节点 ID 使用 new- 前缀，服务端转换为稳定 ID；parentId 为父节点 ID，null 表示顶层。
- summary 必须 20–100 个 Unicode 字符；sourceIds 每节点 1–5 个不重复的真实来源 ID。
- removeIds：0–200 个已有节点 ID。删除父节点时必须同时安排子节点，不能出现悬空结构。
- 无新增或修改需求时可以交空数组，但本批全部来源仍须已出现在最终节点依据中。

~~~json
{
  "reason": "合并劳动与价值的相关认识",
  "upserts": [{
    "id": "new-value",
    "parentId": null,
    "title": "劳动与价值",
    "summary": "劳动形成商品价值，价值关系使劳动的社会性质得到表现。",
    "sourceIds": ["reading-1"]
  }],
  "removeIds": []
}
~~~

## 5. 记忆与 Token 边界

记忆压缩直接调用模型 API，输入压缩提示词、旧记忆、待压缩历史，得到 task/constraints/decisions/conclusions/openQuestions/evidence 六字段 JSON 后原子替换检查点。

- 不创建 Agent、不注册工具，不再把第三个 Agent 伪装成“记忆工具”。
- 结果必须完整、字段正确，evidence 中的来源须已出现于历史；非法、截断或虚构来源时保留旧检查点并报告失败。
- 不补括号、不猜字段、不自动生成或过滤来源来制造压缩成功。
- OpenAI 请求不发送 max_tokens/max_completion_tokens，不按累计“任务 Token 安全预算”取消句读。
- Claude 协议强制要求的 max_tokens 仍须传入配置值，不能宣称协议级无限输出。
- 模型实际上下文窗口、输入容量、三次纠错以及辅助工具循环保护继续保留。句读工具不占旧的 20 次辅助工具额度。

## 6. 验证记录与交付状态

使用 3396、独立构建目录及独立测试数据完成验证，没有向正式 data 写入测试书籍或对话。

- 实际模型：gpt-6.1-sol；资本论选文连续两次句读工具提交、最终综合小结成功。
- 普通追问实际提交 mark_answer_emphasis 成功。
- 两则逐句来源合批入图；两则独立旧历史再次合批，仅增加一个导图版本，旧新来源保留。
- 记忆直接 API 一次调用成功，无工具；保留用户约定。
- TypeScript 严格检查通过；本次专项 30 个测试文件、305 项全部通过。最终全量回归 4310 通过、10 失败、7 跳过，无未处理 Promise 错误。
- 剩余 10 个失败涉及选区历史恢复、PDF 及插件菜单。复制测试材料、回退本次相关文件后亦复现同名失败；该对照不是精确重建整个任务前工作区（未快照文件取 HEAD，其他文件保持当前版本），因此不将它们武断归因于环境或宣称整个基线已通过。
- 当前工作区包含任务开始前已存在及其他任务修改；存在共用文件且部分任务前内容未完整快照。尚不自动混合提交，保留现有暂存与工作区状态。

临时 3396 已释放，本任务两个临时类型 include 已移除。主项目 3000 已在本轮验证期间重启，首页和书库 API 正常（11 本），不再次打断正在使用的页面。主项目验收仅使用 3000、默认 .next 和正式 data；临时端口只用于开发自测。
