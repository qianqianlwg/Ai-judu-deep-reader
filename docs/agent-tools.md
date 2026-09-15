# 第四阶段：阅读 Agent 工具契约

## 交互协议

- 使用 LangChain createAgent、ChatOpenAI / ChatAnthropic 和 Zod typed tools。
- 助手的 content 是正常中文/Markdown；禁止从聊天正文 JSON.parse 反推结构结果。
- 普通聊天仅提供检索工具，不绑定保存句读工具。
- 句读请求需要正常回复与成功的 save_reading_analysis；缺工具结果时保留文本、明确报错，原消息可重试。
- 旧消息只有显式识别为 legacy-json 才使用兼容展示；新工具卡不替换正文。

## 1. search_book

输入：

```json
{"query":"认识","chapterId":null,"limit":5}
```

| 字段 | 约束 |
| --- | --- |
| query | 1–120 字符，当前版本的精确关键词/短语 |
| chapterId | 可选章节 ID；默认 null，全书 |
| limit | 1–8，默认 5 |

句读详细程度由请求中的 detail 控制：concise=精简（约 1:1.2）、standard=标准（约 1:1.5）、detailed=详细（约 1:2）。服务端会按非空白字符数校验 readingText，比例只是近似范围，短选文允许更宽容的下限。

成功输出：

```json
{"ok":true,"sources":[{"sourceId":"book:edition-id:paragraph:paragraph-id","paragraphId":"paragraph-id","chapterId":"chapter-id","chapterTitle":"导论","text":"真实检索片段"}]}
```

无结果返回 sources: []，不生成虚构来源。当前 Agent 工具使用 SQLite 关键词检索；这里不冒充已经建立了向量索引。

## 2. read_source

输入：

```json
{"sourceId":"book:edition-id:paragraph:paragraph-id","neighbors":1}
```

- neighbors：0–2，默认 1；仅扩展同章相邻段落。
- sourceId 必须已在本轮初始上下文或真实检索结果中出现。
- 成功输出与 search_book 相同。
- 未登记来源返回 {"ok":false,"error":"来源未在本轮检索中出现，请先调用 search_book"}。

## 3. save_reading_analysis

输入：

```json
{
  "readingText":"按当前详细程度整理后的句读文本",
  "summary":"这段文字的主要观点",
  "breakdown":[{"label":"前提","text":"该语义层次的解释"}],
  "concepts":[{"name":"认识","text":"本段中这一概念的含义"}],
  "context":"段落在已提供上下文中的作用",
  "uncertainty":"缺失资料或存在歧义时的说明；无则为空字符串",
  "citations":[{"sourceId":"book:edition-id:paragraph:paragraph-id","quote":"来源中逐字出现的原文"}]
}
```

全部字段必填，数组可以为空。readingText 是第一部分句读文本，必须与正常回复中的“句读文本”一致，并按本轮精简/标准/详细比例生成；summary ≤4000字符；breakdown ≤24项；concepts ≤20项；citations ≤16项。精确限制见 src/lib/agent/schemas.ts。

校验规则：

1. 概念名称必须逐字出现在本轮选文中。
2. 每条引用只能来自本轮真实来源，quote 必须是返回片段的子串。
3. paragraphId / messageId 由来源登记表和当前请求绑定，不让模型填写。
4. 文本锚点只接受服务端核验过的段落、字符范围和原文；不合法时明确 locationAvailable: false，不猜位置。
5. 额外字段（包括伪造的 anchor、editionId、messageId）会被 schema 拒绝。

成功输出：

```json
{
  "ok":true,
  "analysisId":"当前助手消息ID",
  "saved":true,
  "locationAvailable":true,
  "result":{
    "summary":"...","breakdown":[],"concepts":[],"context":"...","uncertainty":"",
    "citations":[{"sourceId":"...","paragraphId":"...","messageId":"...","quote":"..."}],
    "anchor":{"paragraphId":"...","startOffset":0,"endOffset":2,"selectedText":"原文"}
  }
}
```

saved 表示结构记录已写入当前助手消息。本轮最终完成后才发布到知识库；后续模型断流时保留草稿并提供重试，不能误报整个请求完成。

语义校验失败输出 {"ok":false,"error":"修正说明"}，可包含 invalidConcepts 或 sourceId。schema 错误转换为工具错误消息，Agent 可在有界循环中修正。数据库审计失败会使本轮失败，不静默吞掉。

## Agent 日志

服务端输出结构化 `[judu-agent]` 日志，记录 `agent_started`、`tool_started`、`tool_finished`、`tool_exception`、`tool_audit_failed`、`analysis_save_requested`、`agent_completed` 和 `agent_failed`。日志包含工具名、请求/尝试 ID、详细程度、长度和错误原因摘要；API Key、Authorization、password、secret 等字段统一脱敏，不记录正文参数。

## SSE 与 Token

- meta：固定 threadId / userMessageId / messageId。
- raw_delta：只有普通文本，客户端即时追加，不模拟打字。
- tool：准备/执行/完成或失败状态；参数 JSON 不混入正文。
- structured：仅来自成功的保存工具。
- usage：输入、输出、缓存读取、本轮累计、当前窗口占用、配置窗口、统计来源。
- done / error：唯一终态；取消、超限、空输出、未调用工具均不能冒充成功。

length、缺工具结果和坏参数等失败也会结算供应商已返回的 usage，不因失败丢失实际消耗。

多步骤 Token 消耗累加；上下文占用只取最后一步的输入+输出，不用累计消耗当窗口占用。生成时暂用明确标识的估算，供应商返回后替换；混合估算不能标成全程精确统计。配置窗口展示输入预算+输出预算，不表示已探测到供应商硬上限。

## 保存与安全边界

- chat_messages 分开保存 content、structured_output、usage_json，记录模型和 v6-agent-tools Prompt 版本。
- agent_tool_runs 记录工具入参/出参和状态，绑定当前消息及会话。
- 保留首次上下文快照、原消息重试、租约和 attemptId 写入栅栏。
- API Key 仅在服务端 Provider 配置中使用，不放入 Prompt、工具入参、工具审计或聊天流。
- 本项目目前为单用户本机应用；公网发布仍需认证、访问隔离、HTTPS、备份及供应商配置检查，不能直接裸露本机 API。

## 内部工具：compress_reading_context

当历史接近预算时，使用当前已配置模型的原生工具参数整理记忆；它不把 JSON 当成聊天正文。

输入/输出字段相同（均必填，数组可以为空）：

~~~json
{
  "task":"当前阅读目标",
  "constraints":["用户的明确约定、禁用事项、译本限制"],
  "decisions":["已确认的决定"],
  "conclusions":["关键概念及已经确认的结论"],
  "openQuestions":["尚未解决的问题"],
  "evidence":["历史资料明确给出的 book:版本ID:paragraph:段落ID"]
}
~~~

服务端核验出处标识，另行绑定 sourceMessageIds、SHA256、版本、模型与 Prompt 版本，保存到 context_snapshots.checkpoint_json。消息 UUID 不属于原文出处，不交给模型充当来源。

压缩规则：

- 不按最近 N 条或消息比例保留历史。
- 按 Token 预算分批整理所有已发生的历史，优先保留中文约定、目标、概念、决定、未解问题和真实证据标识。
- 按实际序列化输入动态装箱，包含旧摘要和引号、反斜线转义开销；降低预算时先收敛旧摘要，不以目标摘要长度代替实际长度。
- 当前问题、选文和原文证据不被偷偷裁掉；固定材料已超限时明确提示。
- 只有完整原消息边界才保存检查点；取消后可复用已完成前缀。
- 检查点后的新消息继续追加；未达到触发线不重写摘要，避免每轮改变缓存前缀。
- 这是适配 OpenAI 兼容网关和 Claude 的可移植方案，不冒充 Codex 内部实现或 OpenAI 原生 compact 服务。

## 重试与审计的补充契约

正常重试固定原问题、选文、版本、历史快照与两个消息 ID。用户修改预算后可显式提交：

~~~json
{"retryContextSettings":{"maxInputTokens":1000000,"maxOutputTokens":4096}}
~~~

它只改变当前执行预算，原 contextSnapshot 不覆盖；执行预算另记在 _request.executionSettings。设置页提供 200000、400000、1000000 三档输入预算；服务端兼容 4096–1000000 的旧/内部整数预算，输出范围为 1024–16384，均须整数。

agent_tool_runs.attempt_id 区分重试尝试。当前工具卡只显示当前尝试；旧尝试和无法判定归属的 NULL 记录保留在独立历史折叠区，不删除、不冒充当前成功。成功请求幂等回放会恢复当前尝试工具事件。

## 本机接口防护

业务 API 默认只接受本机 Host 和同源浏览器请求；写操作要求 JSON，导入除外。跨站请求不能借设置测试接口携带已保存 Key 请求第三方地址。非本机部署须显式设置 JUDU_APP_ORIGIN，同时另外配置认证、HTTPS 和持久数据卷；来源校验不等于用户认证。
