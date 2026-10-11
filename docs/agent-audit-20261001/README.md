# 当前 Agent、提示词与工具参数审计

日期：2026-10-01（Asia/Shanghai）。只读分析当前工作区；包含当前未提交的实现，不以旧文档或上一轮回答替代实际代码。

- [全部提示词原文](./prompts.md)：正常长度/正常难度展开样例，包含所有难度变体、工具描述及动态输入结构。
- [全部工具 JSON Schema](./tool-schemas.json)：由当前 Zod Schema 导出。JSON Schema 不包含所有 refine 和业务定位核验，下面另列这些实际约束。
- 当前活跃调用链有 5 类模型任务；普通阅读还分追问和旧式句读两种模式。旧分块规划器仍存在，但当前细读入口没有调用它。

## 一、“还有 7 则此前完成的句读未纳入导图”是什么

计数并非“7 个缺失节点”，而是当前 bookId 下尚未登记到 guide_sources 的历史句读候选记录数量。

筛选条件：
1. chat_messages.role=assistant、status=completed，content 非空，structured_output 是有效 JSON。
2. 是逐句子消息（有 _semanticParent），或旧式 analyze 回复（没有 semantic 合组字段）。逐句父消息不重复计数；普通聊天不算句读来源。
3. 有 anchor，且 guide_sources 中还没有该 message_id。
4. 按 bookId 归集，可能包含同一本书的多个版本、多个会话，并非仅当前聊天。

点击“纳入已有句读”后的步骤：
1. 用户确认，POST /api/books/[bookId]/guide，参数 action=import-history、version=当前导图版本。
2. 按来源 ID 幂等登记队列；登记时逐字验证锚点、版本、选区原文。不合格来源不登记。
3. 后台 worker 处理队列。它是服务器持久任务，不需要一直打开导图界面。
4. 有相同 _semanticParent 的逐句来源按父消息合批；父消息仍有效 streaming 时等待，不边逐句完成边重复整理。
5. 独立导图 Agent 接收完整已有导图 nodes（去掉 position）和本批完整句读正文 analyses，然后调用 update_reading_guide。
6. 检验节点来源、父节点、循环和导图版本。成功保存可撤销的新版本，并将本批来源标为 completed。

重要区别：
- 登记进队列就会从 historicalCount 中消失，不意味着已生成节点；排队/处理中看 pending，失败看 failed。
- Agent 可以返回 upserts=[]、removeIds=[]，仍把本批标为处理完成；“处理过”不等于“每则有独立节点”。
- 删除节点或撤销导图不会自动把来源退回“历史未纳入”；该计数不检查当前节点是否还引用来源。
- historicalGuideIds 只检查存在 anchor，未逐条核验有效性；实际登记才核验，所以有些候选可能一直显示却无法纳入。
- 新完成句读自动入队。这个按钮补的是历史漏登记，并不会重新细读、重做左侧标注、读取未提供的其它正文。
- 当前 worker 一次只处理一个 job，完成/失败后再等 2 秒取下一 job；不是全书任务并发。

依据：guide-sources.ts、guide-worker.ts、guide-runtime.ts、guide-agent.ts、api/books/[bookId]/guide/route.ts。

## 二、全部 Agent/模型任务与所属工具

| 任务 | 当前是否调用 | 工具 | 模型来源 |
| --- | --- | --- | --- |
| 逐句/逐段细读 | 是，readingStyle=semantic/whole | 仅 submit_reading_sentence | 本次请求选定模型 |
| 细读完成后的综合小结 | 是，句读全部提交之后 | 无工具，普通文字流 | 本次请求选定模型 |
| 思维导图整理 | 是，后台队列 | 仅 update_reading_guide | 后台读取全局默认 AI 配置，不继承聊天临时选定模型 |
| 普通追问/旧式句读 | 是，根据请求分支 | search_book、read_source；追问使用 mark_answer_emphasis，旧式句读使用 save_reading_analysis；另有获授权的外部工具 | 本次请求选定模型 |
| 对话记忆压缩 | 条件触发，历史接近预算时 | 仅 compress_reading_context | 本次请求选定模型 |
| 旧分块规划器 | 代码保留，当前正常细读入口未调用 | 仅 plan_reading_units | 调用者提供模型 |

外部搜索、DOI 核验是普通 Agent 的工具，不是另外几个自主 Agent。

prefetch_book_context 是服务器按选项自动做的预检索/审计活动，不是当前模型可以选择调用的工具。向量索引、embedding、原版章节校验也不是有聊天提示词的 Agent。

## 三、逐句/逐段细读：submit_reading_sentence

所有顶层字段必填。对象严格核验，多余旧字段会被拒绝。

| 字段 | 类型/内容 | 实际规则 |
| --- | --- | --- |
| sourceStart | string | 当前未处理原文的开头，通常 5–8 个 Unicode 字符，最大 8；不足 5 字的短句提交全文 |
| sourceEnd | string | 当前句的逐字原文尾部，通常 5–8 字；歧义后允许更长，最大 160 Unicode 字符 |
| title | string | 当前句小标题，trim 后 1–120 字符 |
| content | string | AI 句读解释正文，trim 后非空，没有应用字符 max；不是原文全文 |
| sourceAnnotations | object | 必填 keywords、keySentences、concepts |
| answerEmphasis | object | 必填 keywords、keySentences |

sourceAnnotations 的子字段：

| 字段 | 类型/内容 | 约束 |
| --- | --- | --- |
| keywords | none 或 array | 每项 {paragraphKey,quote}；1–16 项 |
| keySentences | none 或 array | 每项 {paragraphKey,quote}；1–16 项 |
| concepts | none 或 array | 每项 {paragraphKey,name,text}；1–20 项 |
| paragraphKey | string | /^p[A-Za-z0-9]{5,8}$/，总长度 6–9；当前分配 p000001 等本轮稳定别名 |
| quote | string | 1–1000 字符，必须逐字命中当前句覆盖的该来源段落 |
| name | string | trim 后 1–80 字符，必须逐字出现于当前句来源 |
| text | string | 概念在本段中的解释，trim 后 1–2000 字符 |

answerEmphasis 的子字段：
- keywords：none 或非空 string[]，Schema 1–16 项，每项 1–1000 字符。
- keySentences：none 或非空 string[]，Schema 1–16 项，每项 1–1000 字符。
- 两项引用的是 content 的正文，不是左侧原文。
- 当前内部兼容校验实际只允许总计最多 4 项，关键词最多 3 个、关键句最多 1 个；单条 2–160 字符，关键词最多 16 个 Unicode 字符，关键句至少 8 个 Unicode 字符，不能换行。
- 只能标普通 Markdown 段落中的文字；不标标题、加粗/斜体、链接、代码等内部文字。重叠标注当前会被拒绝。
- 已移除 Agent-facing listTitle、occurrence、marks、kind、version；内部历史存储仍有兼容结构，并不等于再次向 Agent 提供这些参数。

定位与调用规则：
- sourceStart 必须从服务端当前未处理游标开始，不能跳过原文。
- sourceEnd 在整个剩余选文拼接范围内查找；多次匹配报歧义，要求更长尾部，并非仅在某一段查找。
- 少于 5 字、首尾相同的短句按全文定位，不受后续相同短句影响。
- 不自动改字、模糊定位、切句或生成重点。每次只能 1 个工具调用；核验失败交 Agent 修正，同一句最多 3 次。
- 成功落库再发布句读与标注；下一句继续。所有句读完成后，还会进行一次无工具综合小结模型调用。

## 四、思维导图：update_reading_guide

工具是批量增量更新，不是逐节点一个调用。

| 字段 | 类型 | 必填/约束 |
| --- | --- | --- |
| reason | string | 必填，trim 后 1–600 字符；提示词要求一句中文说明 |
| upserts | array | 必填，0–200 项；每项为完整节点，可新增、更新、移动 |
| removeIds | string[] | 必填，0–200 项；要删的已有节点 ID |

每个 upserts 节点：

| 字段 | 类型 | 必填/约束 |
| --- | --- | --- |
| id | string | 必填，1–160 字符；已有节点保持 ID，新节点提示要求 new- 开头，服务端会加来源前缀 |
| parentId | string 或 null | 必填；null 为顶层，否则指向一个存在的父节点 |
| title | string | 必填，trim 后 1–160 字符 |
| summary | string | 必填，trim 后 20–100 个 Unicode 字符；概括已有句读分析 |
| sourceIds | string[] | 必填，1–5 个、不可重复；本批句读 sourceId 或已有节点依据 ID；不是 paragraphKey |
| position | {x:number,y:number} | Schema 仍允许的可选参数；x/y 为有限值且 -1000000 至 1000000；当前 System 输入排除 position，工具描述也没要求 Agent 提交 |

其它规则：
- 不提供检索/读取工具，已有完整 nodes 和 analyses 一次注入。
- 不强迫每句新增节点；可无操作，但无操作仍会完成该批来源。
- Prompt 目前明确允许 AI 修改、移动、合并、删除用户编辑的节点；靠历史版本撤销恢复，没有节点锁定约束。
- 删除父节点要同时删除/移动其子节点；禁止循环、未知来源、重复节点。
- 一轮请求最多 3 次工具格式修正。队列普通失败最多 3 次 job 尝试，因此反复核验失败可能累计至 9 次模型调用；版本冲突另行重新排队，不计普通失败尝试。
- job 4 分钟超时，租约 5 分钟。不会因为用户离开导图页面停止。

输入是：nodes=[已有节点，去掉 position]，analyses=[{sourceId:已完成句读块ID,analysis:已保存完整句读解释正文}]。后台不直接输入原文全文，只绑定来源锚点供页面定位和服务端核验。

## 五、普通阅读/追问 Agent 的书内工具

### 5.1 search_book

| 字段 | 类型 | 必填/默认/约束 |
| --- | --- | --- |
| query | string | 必填，trim 后 1–500 字符 |
| additionalQueries | string[] | 可选，0–2 项，各项 trim 后 1–500 字符 |
| mode | auto/keyword/semantic/hybrid | 可选，实际默认 auto；auto 视索引状态组合关键词与语义 |
| chapterId | string 或 null | 可选，默认 null，表示全书 |
| limit | integer | 可选，默认 5，1–8 |

仅搜索当前书籍/版本；不能让模型建索引或读取其它书。返回真实来源、检索各路耗时和降级信息。

### 5.2 read_source

| 字段 | 类型 | 必填/默认/约束 |
| --- | --- | --- |
| sourceId | string | 必填，1–240 字符，必须已在本轮来源登记表出现 |
| neighbors | integer | 可选，默认 1，0–2 个邻段 |

不能凭猜测 ID 读取其它版本或任意资料。

### 5.3 save_reading_analysis（旧式选文句读分支）

| 字段 | 类型 | 必填/默认/约束 |
| --- | --- | --- |
| readingText | string | 必填，trim 后 1–24000 字符；完整句读正文，应对应已输出正文 |
| summary | string | 可选，默认空字符串，trim 后最多 4000 字符 |
| breakdown | array | 可选，默认 []，最多 24 项；每项必填 label=1–100、text=1–12000 字符 |
| concepts | 无 或 array | 必填；数组 1–20 项，每项 name=trim 后 1–80、text=trim 后 1–2000；name 要逐字出现在选文 |
| context | string | 可选，默认空字符串，最多 6000 字符 |
| uncertainty | string | 可选，默认空字符串，最多 2000 字符 |
| citations | array | 可选，默认 []，最多 16 项；每项必填 sourceId=1–240、quote=trim 后 1–4000 字符 |
| emphasis | 无 或旧对象 | 必填，旧对象结构见 5.5 |

消息 ID、book/edition 和原文 anchor 由服务端绑定，不是模型可写字段。引用逐字核验本轮来源。此工具成功后会给导图队列登记来源。

### 5.4 mark_answer_emphasis（追问分支）

只有一个必填参数 emphasis；值是字符串“无”或下述旧结构。普通追问先完整输出正文，再提交标注，不保存成新句读来源。

### 5.5 两个普通工具仍在用的旧 emphasis

结构：{version:1,marks:[{kind,quote,occurrence}]}，不是新的 answerEmphasis。

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| version | literal 1 | 必填 |
| marks | array | 必填，有重点时 1–4 项 |
| kind | term/key_sentence | 每项必填 |
| quote | string | 每项必填，trim 后 2–160 字符；关键词最多 16 Unicode 字符，关键句至少 8 Unicode 字符，不换行 |
| occurrence | integer | 每项必填，1–99；从 1 开始按出现顺序定位 |

业务层关键词最多 3 个，关键句最多 1 个。只支持普通段落文字、非重叠定位。没有重点必须“无”，目前还不是 none。

## 六、普通 Agent 的可选外部工具

| 工具 | 参数 | 限制/用途 |
| --- | --- | --- |
| search_openalex | {query:string} | 获本轮 OpenAlex 授权才提供；书目/元数据，不代表读过论文 |
| verify_crossref | {query:string} | 获 Crossref 授权才提供；DOI、篇名/出版元数据核验 |
| search_web | {query:string} | 获网页授权才提供；Tavily 网页搜索短片段 |
| read_external_source | {sourceId:string} | 已授权 OpenAlex 或网页且读取器可用才提供；读取本轮已发现的公开来源 |

三个搜索工具 query Schema：trim 后 2–160 字符。业务层另外限制 query.length<=120，所以 Schema 与实际长度不一致。禁止发送选文、笔记、完整对话、邮箱/URL 等敏感或不安全查询；每种来源每轮最多 2 次搜索。

read_external_source.sourceId 正则：^external:(openalex|web):[a-f0-9]{24}$，只能使用本轮实际检索返回的 ID，不接受任意 URL。每轮最多读取 2 条；OpenAlex OA 解析正文可在 OpenAlex 授权下读，Tavily 提取另需网页授权。读取 DOI 文献且 Crossref 已授权时会自动核验，消耗同一 Crossref 次数额度。

这些工具不暴露 model、API Key、endpoint、颜色、保存位置等参数。

## 七、压缩记忆：compress_reading_context

六个字段全部必填；空内容允许空字符串/空数组，不使用 none。

| 字段 | 类型 | 约束/语义 |
| --- | --- | --- |
| task | string | 最多 2000 字符，当前目标 |
| constraints | string[] | 最多 32 项，每项最多 1500 字符，用户约定/限制/否决项 |
| decisions | string[] | 最多 32 项，每项最多 1500 字符，明确决定 |
| conclusions | string[] | 最多 32 项，每项最多 1500 字符，已经确立的理解和概念 |
| openQuestions | string[] | 最多 32 项，每项最多 1500 字符，未解问题 |
| evidence | string[] | 最多 24 项，每项最多 500 字符；只保留历史已出现的 book:版本ID:paragraph:段落ID |

没有本轮回答、原文标注或导图修改权限。当前仍有输入预算核验，以及 maxTokens=max(512,min(4096,outputBudgetTokens,targetTokens*3)) 的显式输出限制；这与“细读工具不主动设输出 Token 上限”不是同一调用。

输入还带之前记忆、本批新增历史、摘要目标 Token。接近输入预算才触发，压缩检查点持久化以便取消/重试恢复。

## 八、保留但未接入当前细读入口：plan_reading_units

顶层：{units:[...]}，units 必填，1–128 项。

每个单元：

| 字段 | 类型 | 必填/约束 |
| --- | --- | --- |
| label | string | 必填，trim 后 1–80 字符 |
| action | read/skip | 必填 |
| reason | string | 必填，trim 后最多 300 字符；skip 说明原因，read 可空 |
| sourceEmphasis | 无 或 array | 必填，数组 1–16 项 |
| endParagraphId | string | 可选，非空，与 endQuote 共同组成首选终点方案 |
| endQuote | string | 可选，1–240 字符，目标段剩余内容中必须唯一；描述推荐 8–40 字 |
| fragments | array | 可选，1–256 项，每项 {paragraphId:非空string,text:非空string} |

endParagraphId+endQuote 和 fragments 二选一，不可混用。起点自动接上一块终点；所有原文必须覆盖且不重复。sourceEmphasis 每项为 {paragraphId,kind:term/key_sentence,quote:1–1000字符,occurrence:1–99}。forceRead=true 时不得 skip。这个旧规划器仍保留应用输入/输出 Token 预算。

## 九、主要优化点（建议，不是已修改）

1. 统一普通追问与逐句细读标注协议：当前仍有 none/无、answerEmphasis/emphasis、无 occurrence/有 occurrence 的分裂。
2. 统一 Schema 和实际标注限制：逐句 Schema 允许 16+16 项、1000 字，内部只接受 3 个词+1 句、单条160；这种隐藏限制会造成无效重试。外部检索160/120字也有同样问题。
3. 合批历史入图：7 则独立旧式句读当前可能触发7个串行 job，每次重发完整导图。可明确批次大小，并按输入窗口合批，不静默截断分析。
4. 改名/拆分计数：“未登记的历史句读”“排队/处理中”“整理失败”“已处理来源”分开显示，不把登记完成说成实际纳入节点。
5. 导图来源处理可解释：无节点变更也算 completed，但工具没有逐来源“已合并到节点/无需新增及原因”的必填回执。是否需要由 Agent 明确提交，值得确认。
6. 用户节点保护：目前明确允许 AI 删除和改写用户编辑节点。建议先确认是允许全部自动调整，还是增加锁定/保护字段；未修改前不能声称已有保护。
7. 导图来源数量：AI 每节点最多5个 sourceIds，人工合并允许更多。已有节点超过5个依据再被AI更新时容易被迫减少来源，应区分保留既有依据和新关联依据。
8. 导图输入与 token：每批完整 nodes+完整 analyses，无显式输入窗口预检；大图可能请求超限或很慢。可评估按真实节点关联提供局部框架+可按需读取工具，而非规则自动生成主题/概念。
9. 细读的可检索能力：当前逐句只绑定 submit_reading_sentence。executeSemanticFlow 虽接受 search/external，未把它们绑定到逐句模型；可选预检索是后端自动做的，不等于细读 Agent 自主检索。
10. sourceEnd 搜索范围：实际扫描整个剩余选文，多段相同尾语容易触发歧义。可讨论加入当前段落短标识/边界协议，但不能用本地规则擅自决定句意边界。
11. 总述另加一次模型调用：细读所有块完成后会再生成综合小结；父请求结束前导图任务等待，因此小结慢会延后开始整理导图。若要两者并行，需要明确状态与完成边界。
12. 导图策略提示可更明确：现在只说“增量整理”，未具体说明哪些关系构成层级、何时合并、何时独立主题、避免摘要重复。这些应由 Agent 判断，不让本地打分代替。

本次没有修改产品代码、服务端口、正式数据或 Agent 行为；只生成本审计文档与 Schema 快照。
