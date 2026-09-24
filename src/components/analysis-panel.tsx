"use client";

import { useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isTokenUsage, type TokenUsage } from "@/lib/token-usage";
import type { ConversationSummary } from "@/lib/conversations";
import { ConversationControls, type ConversationControlsProps } from "./conversation-controls";
import { isAnalysis, isRecord, streamingPreview, type Analysis, type ChatMessage, type Citation, type MessageAnchor, type ToolActivity } from "@/lib/chat-stream";
import { useChatFollow } from "./use-chat-follow";
import styles from "./analysis-panel.module.css";
import { MessageSourceCard as SourceCard } from "./message-source-card";
import { RetrievalActivity } from "./retrieval-activity";
import { MessageActions } from "./message-actions";
import { ComposerOptions, type ReasoningEffort } from "./composer-options";

export type { Analysis, ChatMessage } from "@/lib/chat-stream";
export type PanelMessage = ChatMessage;
type Props = {
  id?: string;
  className?: string; selected: string; analysis: Analysis | null; loading: boolean; error?: string;
  messages?: PanelMessage[];
  onClose: () => void; onBack: () => void; onSend?: (question: string) => void; onRetry?: () => void; onStop?: () => void;
  onEditMessage?: (userMessageId: string, newPrompt: string) => void;
  modelOptions?: readonly string[]; selectedModel?: string; reasoningEffort?: ReasoningEffort;
  onModelChange?: (model: string) => void; onReasoningChange?: (effort: ReasoningEffort) => void;
  onPluginSelect?: (pluginId: "knowledge-base") => void; onCitationSelect?: () => void;
  conversations?: ConversationSummary[]; activeThreadId?: string | null; editionId?: string;
  conversationsLoading?: boolean; conversationError?: string;
  onNewConversation?: ConversationControlsProps["onNewConversation"];
  onSelectConversation?: ConversationControlsProps["onSelectConversation"];
  onRenameConversation?: ConversationControlsProps["onRenameConversation"];
  modelName?: string; usage?: TokenUsage;
  onOpenSource?: (anchor: MessageAnchor) => void;
  onOpenCitation?: (paragraphId: string, quote: string, messageId?: string) => void;
};
import { readReadingAnchor } from "@/lib/reading-anchors";
const EMPTY_MESSAGES: PanelMessage[] = [];

function validAnchor(value: unknown): value is MessageAnchor { return readReadingAnchor(value) !== null; }
function messageAnchor(message: PanelMessage): MessageAnchor | undefined {
  if (validAnchor(message.anchor)) return message.anchor;
  const saved: unknown = message.analysis;
  // WHY：只认这条消息显式保存的合法锚点，不把当前选区或相邻消息的原文冒充历史选文。
  return isRecord(saved) && validAnchor(saved.anchor) ? saved.anchor : undefined;
}
function validCitation(value: unknown): value is Citation {
  return isRecord(value) && typeof value.sourceId === "string" && typeof value.paragraphId === "string" && typeof value.quote === "string";
}
function ReadableText({ content }: { content: string }) {
  return <div className="message-content readable-text">{content.split(/\n{2,}/u).map((part, index) => <p key={index}>{part.trim()}</p>)}</div>;
}
function StructuredAnswer({ analysis, rawContent, messageId, onOpenCitation }: {
  analysis: Analysis; rawContent: string; messageId?: string; onOpenCitation?: Props["onOpenCitation"];
}) {
  const citations = Array.isArray(analysis.citations) ? analysis.citations.filter(validCitation) : [];
  return <div className="message-content assistant-readable">
    {analysis.readingText && <section><h4>句读文本</h4><p className="reading-text-result">{analysis.readingText}</p></section>}
    {analysis.summary && <p className="assistant-summary">{analysis.summary}</p>}
    {analysis.breakdown.length > 0 && <section><h4>句子拆解</h4>{analysis.breakdown.map((item, index) => <div className="answer-row" key={index}><b>{item.label}</b><span>{item.text}</span></div>)}</section>}
    {analysis.concepts.length > 0 && <section><h4>关键概念</h4>{analysis.concepts.map((item, index) => <div className="answer-row" key={index}><b>{item.name}</b><span>{item.text}</span></div>)}</section>}
    {analysis.context && <section><h4>上下文</h4><p>{analysis.context}</p></section>}
    {analysis.uncertainty && <p className="answer-note">说明：{analysis.uncertainty}</p>}
    {citations.length > 0 && <section><h4>原文引用</h4>{citations.map((citation, index) => <button type="button" className="citation-link" key={citation.sourceId + "-" + index}
      disabled={!onOpenCitation} onClick={() => onOpenCitation?.(citation.paragraphId, citation.quote, citation.messageId ?? messageId)}>“{citation.quote}” →</button>)}</section>}
    <details className="raw-output"><summary>查看原始输出</summary><pre>{rawContent}</pre></details>
  </div>;
}
function MarkdownText({ content }: { content: string }) {
  return <div className={"message-content " + styles.markdown} data-output-format="text">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      // WHY：模型生成的图片 URL 不可信；即便 skipHtml，Markdown 图片仍会自动请求并可能泄露阅读资料。
      img: ({ alt }) => <span role="note" data-blocked-image="true">[图片未自动加载{alt ? "：" + alt : ""}]</span>,
      a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a> }}>{content}</Markdown>
  </div>;
}
function toolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  try { return JSON.stringify(result, null, 2) ?? "工具未返回展示内容"; }
  catch (error: unknown) { console.error("展示工具结果失败", error); return "工具结果无法展示"; }
}
function ToolActivityResult({ tool, messageId, onOpenCitation, historical = false }: { tool: ToolActivity; messageId?: string; onOpenCitation?: Props["onOpenCitation"]; historical?: boolean }) {
  const result = isRecord(tool.result) ? tool.result : undefined;
  const errorText = result && (typeof result.detail === "string" ? (typeof result.error === "string" ? result.error + "：" + result.detail : result.detail) : typeof result.message === "string" ? result.message : typeof result.error === "string" ? result.error : undefined);
  if (tool.name === "compress_reading_context") return <p role="status" data-context-progress="true" className={tool.status === "error" ? styles.failedMessage : undefined}>
    {/* WHY：上下文整理是内部进度，不把记忆快照或工具参数作为聊天正文、JSON 卡片公开。 */}
    {typeof tool.result === "string" ? tool.result : tool.status === "running" ? "正在整理阅读记忆…" : tool.status === "error" ? "阅读记忆整理未完成，可以重试。" : "阅读记忆整理完成。"}
  </p>;
  if (tool.name === "search_book" || tool.name === "read_source") {
    const sources = Array.isArray(result?.sources) ? result.sources.filter((source): source is { sourceId: string; paragraphId: string; chapterTitle?: string; text: string } => isRecord(source) && typeof source.sourceId === "string" && typeof source.paragraphId === "string" && typeof source.text === "string" && source.text.length > 0) : [];
    if (!sources.length) return <p>{errorText ?? (tool.status === "running" ? "正在检索本书…" : "本次没有返回可展示的原文出处。")}</p>;
    return <div className={styles.toolSources}>
      <p>{tool.name === "search_book" ? "检索到" : "读取到"} {sources.length} 段原文{result?.displayLimited === true ? "（历史摘录已限制长度）" : ""}</p>
      {sources.map((source, index) => <div className={styles.toolSource} data-source-id={source.sourceId} key={source.sourceId + "-" + index}>
        <div className={styles.toolSourceTitle}>{typeof source.chapterTitle === "string" ? source.chapterTitle : "原文出处"}</div>
        <details><summary className={styles.toolSourcePreview}>{source.text.slice(0, 160)}{source.text.length > 160 ? "…" : ""}</summary><blockquote>{source.text}</blockquote></details>
        <button type="button" className={styles.sourceLink} disabled={!onOpenCitation} aria-label="定位检索原文" onClick={() => onOpenCitation?.(source.paragraphId, source.text, messageId)}>定位原文 ↗</button>
      </div>)}
    </div>;
  }
  if (tool.name === "save_reading_analysis") return <p className={tool.status === "error" || result?.ok === false ? styles.failedMessage : undefined}>
    {result?.ok === true && result.saved === true ? (historical ? "该历史尝试曾保存句读；不代表当前回复的句读记录。" : "句读已保存，可展开上方句读记录查看。") : errorText ?? (tool.status === "running" ? "正在保存句读…" : "句读尚未保存成功。")}
  </p>;
  return tool.result === undefined ? <p>{tool.status === "running" ? "等待工具返回结果…" : "工具没有返回展示结果。"}</p> : <pre className={styles.toolOutput}>{toolResultText(tool.result)}</pre>;
}
const TOOL_LABELS: Record<string, string> = { search_book: "本书检索", read_source: "读取原文", save_reading_analysis: "保存句读", compress_reading_context: "整理阅读记忆" };
function ToolRecords({ message, onOpenCitation, includeAnalysis = true }: { message: PanelMessage; onOpenCitation?: Props["onOpenCitation"]; includeAnalysis?: boolean }) {
  const analysis = includeAnalysis && isAnalysis(message.analysis) ? message.analysis : undefined;
  const tools = Array.isArray(message.tools) ? message.tools.filter((tool): tool is ToolActivity => isRecord(tool) && typeof tool.id === "string" && typeof tool.name === "string" && tool.name !== "search_book" && tool.name !== "read_source" && ["running", "completed", "error"].includes(String(tool.status))) : [];
  const warnings = Array.isArray(message.warnings) ? message.warnings.filter((warning): warning is string => typeof warning === "string") : [];
  return <>
    {analysis && <details className={styles.toolRecord} data-testid="analysis-record"><summary>句读记录 <span>工具结果</span></summary>
      <StructuredAnswer analysis={analysis} rawContent={JSON.stringify({ readingText: analysis.readingText, summary: analysis.summary, breakdown: analysis.breakdown, concepts: analysis.concepts, context: analysis.context, uncertainty: analysis.uncertainty, citations: analysis.citations }, null, 2)} messageId={message.id} onOpenCitation={onOpenCitation} />
    </details>}
    {tools.map((tool) => <details className={styles.toolRecord} data-tool-id={tool.id} key={tool.id}>
      <summary>{TOOL_LABELS[tool.name] ?? tool.name}<span>{tool.status === "running" ? "执行中" : tool.status === "error" ? "执行失败" : "已完成"}</span></summary>
      <ToolActivityResult tool={tool} messageId={message.id} onOpenCitation={onOpenCitation} />
    </details>)}
    {!!message.historicalTools?.length && <details className={styles.toolRecord} data-testid="historical-tools">
      <summary>历史尝试工具 <span>{message.historicalTools.length} 项</span></summary>
      <p>仅保留审计记录，不属于本轮回复；归属未知的旧记录未自动关联到当前尝试。</p>
      {message.historicalTools.map(tool => <details className={styles.toolRecord} key={tool.auditId} data-historical-tool-id={tool.auditId}>
        <summary>{TOOL_LABELS[tool.name] ?? tool.name}<span>{tool.attemptId === null ? "归属未知" : "旧尝试"} · {tool.status === "completed" ? "已完成" : "未完成"}</span></summary>
        <ToolActivityResult tool={tool} messageId={message.id} onOpenCitation={onOpenCitation} historical />
      </details>)}
    </details>}
    {warnings.map((warning, index) => <p className={styles.messageWarning} data-testid="message-warning" role="status" key={index}>提示：{warning}</p>)}
  </>;
}
function AssistantMessage({ message, onOpenCitation }: { message: PanelMessage; onOpenCitation?: Props["onOpenCitation"] }) {
  const legacy = message.outputFormat === "legacy-json";
  // WHY：只有显式标记的旧 v4/v5 记录允许 JSON 兼容显示；新消息一直展示普通 content，工具不能替换回复。
  if (legacy) {
    const content = message.status !== "streaming" && message.status !== "error" && isAnalysis(message.analysis)
      ? <><StructuredAnswer analysis={message.analysis} rawContent={message.content} messageId={message.id} onOpenCitation={onOpenCitation} /><ToolRecords message={message} onOpenCitation={onOpenCitation} includeAnalysis={false} /></>
      : <><div data-streaming-format="friendly-preview"><ReadableText content={message.content ? streamingPreview(message.content, message.kind) : "正在生成句读…"} />
        {message.status === "error" && <p className={styles.failedMessage} role="status">生成未完成，可在原消息上重试。</p>}
        <ToolRecords message={message} onOpenCitation={onOpenCitation} includeAnalysis={false} />
      </div></>;
    return <>{content}<MessageActions message={message} /></>;
  }
  return <>
    <div className={message.status === "streaming" ? "streaming-cursor" : undefined} data-streaming-format="markdown">
      <MarkdownText content={message.content || (message.status === "streaming" ? "正在生成回答…" : "")} />
    </div>
    <ToolRecords message={message} onOpenCitation={onOpenCitation} />
    <MessageActions message={message} />
    {message.status === "error" && <p className={styles.failedMessage} role="status">生成未完成，可在原消息上重试。</p>}
  </>;
}
function tokenNumber(value: number | undefined): string { return value === undefined ? "未返回" : value.toLocaleString("zh-CN"); }
function shortTokens(value: number): string { return value >= 1000 ? (Math.round(value / 100) / 10).toLocaleString("en-US") + "k" : String(value); }
function UsageFooter({ modelName, usage }: { modelName?: string; usage?: TokenUsage }) {
  const valid = isTokenUsage(usage) ? usage : undefined;
  const percentage = valid && valid.contextWindow > 0 ? Math.min(100, Math.round(valid.contextTokens / valid.contextWindow * 100)) : undefined;
  const contextLabel = valid ? (valid.source === "estimated" ? "≈ " : "") + shortTokens(valid.contextTokens) + " / " + (valid.contextWindow > 0 ? shortTokens(valid.contextWindow) : "窗口未配置") : "用量待返回";
  return <div className={styles.usageFooter} data-testid="usage-footer">
    <span className={styles.modelName} title={modelName}>{modelName || "模型未载入"}</span>
    <details className={styles.usageDetails}>
      <summary aria-label="查看 Token 用量">
        <span className={styles.contextRing} aria-hidden="true" style={{ background: percentage === undefined ? "var(--composer-border)" : "conic-gradient(var(--composer-accent) " + percentage + "%, var(--composer-border) 0)" }} />
        <span>{contextLabel}</span><span className={styles.usageSource}>{valid ? valid.source === "provider" ? "服务端统计" : "估算" : "未知"}</span>
      </summary>
      {valid ? <div className={styles.usageBreakdown}>
        <p>{valid.source === "provider" ? "用量由模型服务端返回。" : "以下为本地估算，不是实际计费数据。"}</p>
        <dl><dt>上下文占用</dt><dd>{tokenNumber(valid.contextTokens)} / {valid.contextWindow > 0 ? tokenNumber(valid.contextWindow) : "窗口未配置"}</dd>
          <dt>本轮输入</dt><dd>{tokenNumber(valid.inputTokens)}</dd><dt>本轮输出</dt><dd>{tokenNumber(valid.outputTokens)}</dd>
          <dt>缓存读取</dt><dd>{tokenNumber(valid.cachedInputTokens)}</dd><dt>本轮合计</dt><dd>{tokenNumber(valid.totalTokens)}</dd></dl>
        <p>上下文占用不等于累计消耗；缓存读取属于输入的一部分。</p>
      </div> : <p className={styles.usageUnknown}>尚未收到本会话的用量统计，不显示虚构数值。</p>}
    </details>
  </div>;
}

export function AnalysisPanel({ id, className = "analysis-panel", selected, analysis, loading, error, messages = EMPTY_MESSAGES, onClose, onBack, onSend, onRetry, onStop, onOpenSource, onOpenCitation, conversations = [], activeThreadId, editionId, conversationsLoading = false, conversationError, onNewConversation, onSelectConversation, onRenameConversation, modelName, usage, onEditMessage, modelOptions, selectedModel, reasoningEffort, onModelChange, onReasoningChange, onPluginSelect, onCitationSelect }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const generating = loading || messages.some((message) => message.status === "streaming");
  const interactionLocked = generating || conversationsLoading;
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const { viewportRef, contentRef, showLatest, jumpToLatest, pauseFollowing } = useChatFollow(generating, messages, activeThreadId ?? editionId);
  const submit = () => {
    const textarea = textareaRef.current;
    const value = textarea?.value.trim();
    if (!interactionLocked && value && onSend) { onSend(value); if (textarea) textarea.value = ""; }
  };
  return <aside id={id} className={className + " " + styles.panel} aria-label="句读聊天区" data-testid="analysis-panel" data-has-analysis={isAnalysis(analysis) ? "true" : "false"}>
    <div className={"analysis-header " + styles.header}><h2 className={styles.srOnly}>句读</h2><ConversationControls key={activeThreadId ?? editionId ?? "unbound"} conversations={conversations} activeThreadId={activeThreadId} editionId={editionId} busy={interactionLocked} error={conversationError} onNewConversation={onNewConversation} onSelectConversation={onSelectConversation} onRenameConversation={onRenameConversation} /><button type="button" className="close-button" disabled={interactionLocked} onClick={() => { if (!interactionLocked) onClose(); }} aria-label="关闭句读面板">×</button></div>
    <div className={styles.scrollRegion}>
      <div className={"chat-messages " + styles.messages} ref={viewportRef} data-testid="chat-messages" data-message-count={messages.length}
        data-raw-output-policy="collapsible" role="log" aria-label="阅读对话" aria-live={loading ? "polite" : "off"} aria-busy={loading} tabIndex={0}
        onClickCapture={(event) => { if (event.target instanceof Element && event.target.closest("summary,button")) pauseFollowing(); }}>
        <div ref={contentRef}>
          {conversationsLoading && <p role="status">正在读取会话…</p>}
          {messages.length === 0 && !conversationsLoading && selected && <div className="book-context"><span>待句读的选文</span><p>“{selected}”</p></div>}
          {messages.map((message, index) => {
            const anchor = messageAnchor(message);
            return <article data-message-id={message.id} className={"chat-message " + message.role + " " + styles.messageGroup} key={message.id ?? message.role + "-" + index}>
              <div className="message-role">{message.role === "user" ? "你" : "句读"}</div>
              {message.role === "user" ? <><ReadableText content={message.content} /><MessageActions message={message} editingDisabled={interactionLocked} onEditMessage={onEditMessage} /></> : <><RetrievalActivity message={message} onOpenCitation={onOpenCitation} /><AssistantMessage message={message} onOpenCitation={onOpenCitation} /></>}
              {anchor && <SourceCard anchor={anchor} messageId={message.id} role={message.role} onOpenSource={onOpenSource} onOpenCitation={onOpenCitation} />}
            </article>;
          })}
          {/* WHY：失败属于对话状态，跟随消息滚动，不能挤占输入区或让长错误撑破短视口。 */}
          {error && <section className={styles.errorCard} role="alert" aria-label="生成状态">
            <div className={styles.errorHeading}><span aria-hidden="true">!</span><h3>{error.startsWith("已停止") ? "已停止生成" : "生成暂时失败"}</h3></div>
            <p>{error}</p><button type="button" disabled={interactionLocked || !onRetry} onClick={onRetry}>{lastAssistant?.kind === "chat" ? "重试回答" : "重新句读"}</button>
          </section>}
          {messages.length === 0 && !loading && !conversationsLoading && !error && !selected && <div className="analysis-empty"><h3>选择原文开始句读</h3><p>选中正文中的一句或一段，右侧会显示回答，并可以继续追问。</p></div>}
        </div>
      </div>
      <button type="button" className={styles.latestButton} data-testid="latest-message-button" hidden={!showLatest} onClick={jumpToLatest}>回到最新消息 <span aria-hidden="true">↓</span></button>
    </div>
    {loading && <span className={styles.srOnly} role="status">正在生成回答</span>}

    {/* WHY：输入区独立使用局部类，避免历史全局样式覆盖主题与操作按钮。 */}
    <div className={styles.composer}>
      <UsageFooter modelName={modelName} usage={usage ?? lastAssistant?.usage} />
      <textarea className={styles.composerInput} key={activeThreadId ?? editionId ?? "unbound"} ref={textareaRef} disabled={interactionLocked} onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
      }} placeholder="继续追问…" aria-label="继续追问" />
      <div className={styles.composerFooter}><div className={styles.composerFooterStart}><ComposerOptions disabled={interactionLocked} modelName={modelName} modelOptions={modelOptions} selectedModel={selectedModel} reasoningEffort={reasoningEffort} onModelChange={onModelChange} onReasoningChange={onReasoningChange} onPluginSelect={onPluginSelect} onCitationSelect={onCitationSelect} /><button type="button" className={styles.backButton} onClick={onBack}>回到原文</button></div><button type="button" className={styles.sendButton + (generating ? " " + styles.stopButton : "")} disabled={generating ? !onStop : interactionLocked || !onSend} onClick={() => { if (generating) onStop?.(); else submit(); }} aria-label={generating ? "停止生成" : "发送追问"} title={generating ? "停止生成，保留已收到的内容" : "发送追问"}><span aria-hidden="true">{generating ? "■" : "↑"}</span></button></div>
    </div>
  </aside>;
}
