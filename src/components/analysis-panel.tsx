"use client";

import { useRef } from "react";
import { isAnalysis, isRecord, streamingPreview, type Analysis, type ChatMessage, type Citation, type MessageAnchor } from "@/lib/chat-stream";
import { useChatFollow } from "./use-chat-follow";
import styles from "./analysis-panel.module.css";

export type { Analysis, ChatMessage } from "@/lib/chat-stream";
export type PanelMessage = ChatMessage;
type Props = {
  className?: string; selected: string; analysis: Analysis | null; loading: boolean; error?: string;
  messages?: PanelMessage[];
  onClose: () => void; onBack: () => void; onSend?: (question: string) => void; onRetry?: () => void;
  onOpenSource?: (anchor: MessageAnchor) => void;
  onOpenCitation?: (paragraphId: string, quote: string, messageId?: string) => void;
};
const EMPTY_MESSAGES: PanelMessage[] = [];

function validAnchor(value: unknown): value is MessageAnchor {
  return isRecord(value) && typeof value.paragraphId === "string" && value.paragraphId.length > 0
    && typeof value.startOffset === "number" && Number.isInteger(value.startOffset) && value.startOffset >= 0
    && typeof value.endOffset === "number" && Number.isInteger(value.endOffset) && value.endOffset > value.startOffset
    && typeof value.selectedText === "string" && value.selectedText.length === value.endOffset - value.startOffset;
}
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
function SourceCard({ anchor, messageId, role, onOpenSource, onOpenCitation }: {
  anchor: MessageAnchor; messageId?: string; role: PanelMessage["role"];
  onOpenSource?: Props["onOpenSource"]; onOpenCitation?: Props["onOpenCitation"];
}) {
  const excerpt = anchor.selectedText.replace(/\s+/gu, " ").trim();
  const preview = Array.from(excerpt).slice(0, 80).join("");
  const label = role === "user" ? "本次选文" : "句读原文";
  return <div className={styles.sourceCard} data-testid="message-source" data-source-paragraph={anchor.paragraphId}>
    <details className={styles.sourceDetails}>
      <summary aria-label={"展开" + label}>
        <span className={styles.sourceLabel}>{label}</span>
        <span className={styles.sourcePreview}>{preview}{Array.from(excerpt).length > 80 ? "…" : ""}</span>
        <span className={styles.expandHint} aria-hidden="true">展开原文</span>
        <span className={styles.collapseHint} aria-hidden="true">收起原文</span>
      </summary>
      <blockquote className={styles.sourceText}>{anchor.selectedText}</blockquote>
    </details>
    <button type="button" className={styles.sourceLink} disabled={!onOpenSource && !onOpenCitation}
      aria-label={"定位" + label} onClick={() => {
        if (onOpenSource) onOpenSource(anchor);
        else onOpenCitation?.(anchor.paragraphId, anchor.selectedText, messageId);
      }}>定位原文 <span aria-hidden="true">↗</span></button>
  </div>;
}
function StructuredAnswer({ analysis, rawContent, messageId, onOpenCitation }: {
  analysis: Analysis; rawContent: string; messageId?: string; onOpenCitation?: Props["onOpenCitation"];
}) {
  const citations = Array.isArray(analysis.citations) ? analysis.citations.filter(validCitation) : [];
  return <div className="message-content assistant-readable">
    <p className="assistant-summary">{analysis.summary}</p>
    {analysis.breakdown.length > 0 && <section><h4>句子拆解</h4>{analysis.breakdown.map((item, index) => <div className="answer-row" key={index}><b>{item.label}</b><span>{item.text}</span></div>)}</section>}
    {analysis.concepts.length > 0 && <section><h4>关键概念</h4>{analysis.concepts.map((item, index) => <div className="answer-row" key={index}><b>{item.name}</b><span>{item.text}</span></div>)}</section>}
    {analysis.context && <section><h4>上下文</h4><p>{analysis.context}</p></section>}
    {analysis.uncertainty && <p className="answer-note">说明：{analysis.uncertainty}</p>}
    {citations.length > 0 && <section><h4>原文引用</h4>{citations.map((citation, index) => <button type="button" className="citation-link" key={citation.sourceId + "-" + index}
      disabled={!onOpenCitation} onClick={() => onOpenCitation?.(citation.paragraphId, citation.quote, citation.messageId ?? messageId)}>“{citation.quote}” →</button>)}</section>}
    <details className="raw-output"><summary>查看原始输出</summary><pre>{rawContent}</pre></details>
  </div>;
}
function AssistantMessage({ message, onOpenCitation }: { message: PanelMessage; onOpenCitation?: Props["onOpenCitation"] }) {
  if (message.status === "streaming") return <div className="streaming-cursor" data-streaming-format={message.kind === "analysis" ? "friendly-preview" : "plain-text"}>
    <ReadableText content={message.content ? streamingPreview(message.content, message.kind) : message.kind === "analysis" ? "正在生成句读…" : "正在生成内容…"} />
  </div>;
  // WHY：失败时 structured_output 可能只有 _request 元数据；必须完整校验，不能因对象存在就读取 breakdown.length。
  if (message.status !== "error" && message.kind === "analysis" && isAnalysis(message.analysis)) {
    return <StructuredAnswer analysis={message.analysis} rawContent={message.content} messageId={message.id} onOpenCitation={onOpenCitation} />;
  }
  return <>
    {message.content && <ReadableText content={streamingPreview(message.content, message.kind)} />}
    {message.status === "error" ? <p className={styles.failedMessage} role="status">生成未完成，可在原消息上重试。</p>
      : !message.content && <ReadableText content="暂时没有生成内容。" />}
  </>;
}

export function AnalysisPanel({ className = "analysis-panel", selected, analysis, loading, error, messages = EMPTY_MESSAGES, onClose, onBack, onSend, onRetry, onOpenSource, onOpenCitation }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const generating = loading || messages.some((message) => message.status === "streaming");
  const { viewportRef, contentRef, showLatest, jumpToLatest, pauseFollowing } = useChatFollow(generating, messages);
  const submit = () => {
    const textarea = textareaRef.current;
    const value = textarea?.value.trim();
    if (!loading && value && onSend) { onSend(value); if (textarea) textarea.value = ""; }
  };
  return <aside className={className} aria-label="句读聊天区" data-testid="analysis-panel" data-has-analysis={isAnalysis(analysis) ? "true" : "false"}>
    <div className="analysis-header"><div><div className="panel-kicker">AI READING TOOL</div><h2>句读</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="关闭句读面板">×</button></div>
    <div className={styles.scrollRegion}>
      <div className={"chat-messages " + styles.messages} ref={viewportRef} data-testid="chat-messages" data-message-count={messages.length}
        data-raw-output-policy="collapsible" role="log" aria-label="阅读对话" aria-live={loading ? "polite" : "off"} aria-busy={loading} tabIndex={0}
        onClickCapture={(event) => { if (event.target instanceof Element && event.target.closest("summary,button")) pauseFollowing(); }}>
        <div ref={contentRef}>
          {messages.length === 0 && selected && <div className="book-context"><span>待句读的选文</span><p>“{selected}”</p></div>}
          {messages.map((message, index) => {
            const anchor = messageAnchor(message);
            return <article data-message-id={message.id} className={"chat-message " + message.role} key={message.id ?? message.role + "-" + index}>
              <div className="message-role">{message.role === "user" ? "你" : "句读"}</div>
              {message.role === "user" ? <ReadableText content={message.content} /> : <AssistantMessage message={message} onOpenCitation={onOpenCitation} />}
              {anchor && <SourceCard anchor={anchor} messageId={message.id} role={message.role} onOpenSource={onOpenSource} onOpenCitation={onOpenCitation} />}
            </article>;
          })}
          {messages.length === 0 && !loading && !error && !selected && <div className="analysis-empty"><h3>选择原文开始句读</h3><p>选中正文中的一句或一段，右侧会显示回答，并可以继续追问。</p></div>}
        </div>
      </div>
      <button type="button" className={styles.latestButton} data-testid="latest-message-button" hidden={!showLatest} onClick={jumpToLatest}>回到最新消息 <span aria-hidden="true">↓</span></button>
    </div>
    {loading && <span className={styles.srOnly} role="status">正在生成回答</span>}
    {error && <div className="analysis-error" role="alert"><h3>句读暂时失败</h3><p>{error}</p><button type="button" disabled={loading || !onRetry} onClick={onRetry}>重新句读</button></div>}
    <div className="chat-composer">
      <textarea ref={textareaRef} disabled={loading} onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
      }} placeholder="继续追问…" aria-label="继续追问" />
      <div className="composer-footer"><button type="button" onClick={onBack}>回到原文</button><button type="button" className="send-button" disabled={loading || !onSend} onClick={submit} aria-label="发送追问">↑</button></div>
    </div>
  </aside>;
}
