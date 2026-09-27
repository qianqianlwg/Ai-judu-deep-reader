"use client";

import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { isAnalysis, type Analysis, type ChatMessage } from "@/lib/chat-stream";
import { SpeechButton } from "./speech-controls";
import { speechPlainText } from "@/lib/speech";
import styles from "./message-actions.module.css";

type CopyableMessage = Pick<ChatMessage, "role" | "content" | "analysis" | "outputFormat">;
export type MessageActionsProps = {
  message: CopyableMessage & { id?: string; createdAt?: string; status?: ChatMessage["status"] };
  children?: ReactNode;
  editingDisabled?: boolean;
  onEditMessage?: (userMessageId: string, newPrompt: string) => void;
};

function analysisText(analysis: Analysis): string {
  const sections: string[] = [];
  if (analysis.readingText?.trim()) sections.push("句读文本\n" + analysis.readingText.trim());
  if (analysis.summary.trim()) sections.push(analysis.summary.trim());
  if (analysis.breakdown.length) sections.push("句读要点\n" + analysis.breakdown.map(item => item.label + "：" + item.text).join("\n"));
  if (analysis.concepts.length) sections.push("关键概念\n" + analysis.concepts.map(item => item.name + "：" + item.text).join("\n"));
  if (analysis.context.trim()) sections.push("上下文\n" + analysis.context.trim());
  if (analysis.uncertainty.trim()) sections.push("说明\n" + analysis.uncertainty.trim());
  return sections.join("\n\n");
}
function legacyReadable(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const item = parsed as Partial<Analysis>;
    if (typeof item.summary !== "string" || !Array.isArray(item.breakdown) || !Array.isArray(item.concepts) || typeof item.context !== "string" || typeof item.uncertainty !== "string") return undefined;
    const normalized: Analysis = {
      readingText: typeof item.readingText === "string" ? item.readingText : undefined,
      summary: item.summary,
      breakdown: item.breakdown.filter((part): part is { label: string; text: string } => Boolean(part && typeof part === "object" && typeof part.label === "string" && typeof part.text === "string")),
      concepts: item.concepts.filter((part): part is { name: string; text: string } => Boolean(part && typeof part === "object" && typeof part.name === "string" && typeof part.text === "string")),
      context: item.context,
      uncertainty: item.uncertainty,
      citations: [],
    };
    return analysisText(normalized);
  } catch { return undefined; }
}

export function readableAssistantText(message: CopyableMessage): string {
  if (isAnalysis(message.analysis)) return analysisText(message.analysis);
  const content = message.content.trim();
  if (message.outputFormat === "legacy-json" || content.startsWith("{")) return legacyReadable(content) ?? message.content;
  return message.content;
}

async function copyText(text: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("当前环境不支持复制，请手动选择文本复制");
  await navigator.clipboard.writeText(text);
}

export function MessageActions({ message, editingDisabled = false, onEditMessage, children }: MessageActionsProps) {
  const textarea=useRef<HTMLTextAreaElement>(null),editButton=useRef<HTMLButtonElement>(null),returnFocus=useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [feedback, setFeedback] = useState("");

  useLayoutEffect(()=>{
    if(!editing){if(returnFocus.current){returnFocus.current=false;editButton.current?.focus();}return;}
    if(!textarea.current)return;
    const input=textarea.current;input.style.height="auto";input.style.height=Math.min(260,Math.max(84,input.scrollHeight))+"px";
  },[editing,draft]);
  const cancelEdit=()=>{returnFocus.current=true;setEditing(false);setFeedback("");};
  const copy=(text:string)=>{setFeedback("");void copyText(text).then(()=>setFeedback("已复制")).catch((error:unknown)=>{console.error("消息复制失败",error);setFeedback(error instanceof Error?error.message:"复制失败，请重试");});};
  if (message.role === "user") {
    const canEdit = Boolean(message.id && onEditMessage && !editingDisabled);
    const date=message.createdAt?new Date(message.createdAt):null;
    const validDate=date!==null&&Number.isFinite(date.getTime());
    // WHY：编辑框原位替换气泡，不在原消息下面叠加第二份正文；源文卡片由父组件保留。
    return <div className={styles.userMessage} data-editing={editing}>
      {editing?<form className={styles.editor} data-message-editor="" onSubmit={(event:FormEvent)=>{
        event.preventDefault();if(editingDisabled)return;
        const prompt=draft.trim();if(!prompt){setFeedback("问题不能为空");return;}
        if(!message.id||!onEditMessage){setFeedback("当前消息暂不可编辑");return;}
        onEditMessage(message.id,prompt);setEditing(false);setFeedback("");
      }}>
        <textarea ref={textarea} autoFocus aria-label="编辑原始问题" value={draft} onChange={event=>setDraft(event.target.value)} disabled={editingDisabled} onKeyDown={event=>{
          if(event.key==="Escape"&&!editingDisabled){event.preventDefault();cancelEdit();}
          else if(event.key==="Enter"&&(event.ctrlKey||event.metaKey)&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit();}
        }}/>
        <div className={styles.editorActions}><button type="button" onClick={cancelEdit} disabled={editingDisabled}>取消</button><button type="submit" disabled={editingDisabled||!draft.trim()}>发送</button></div>
      </form>:<>
        <div className={styles.userBubble}>{children??<p>{message.content}</p>}</div>
        <div className={styles.userActions} aria-label="用户消息操作">
          {validDate&&<time dateTime={date.toISOString()} title={date.toLocaleString('zh-CN')}>{date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}</time>}
          <button type="button" aria-label="复制问题" title="复制问题" onClick={()=>copy(message.content)}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M12 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h2" stroke="currentColor" strokeWidth="1.4"/></svg></button>
          <button ref={editButton} type="button" aria-label="编辑原始问题" title={editingDisabled?"生成中不能编辑":"编辑并重新发送"} disabled={!canEdit} onClick={()=>{setDraft(message.content);setEditing(true);setFeedback("");}}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m12.5 3.5 4 4M4 12l8.5-8.5a2.8 2.8 0 0 1 4 4L8 16l-5 1z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
        </div>
      </>}
      {feedback&&<p className={styles.feedback} role={editing?'alert':'status'}>{feedback}</p>}
    </div>;
  }

  if (!message.content && !message.analysis) return null;
  return <div className={styles.actions}>
    <button type="button" aria-label="复制回答" onClick={() => { setFeedback(""); void copyText(readableAssistantText(message)).then(() => setFeedback("已复制")).catch(error => setFeedback(error instanceof Error ? error.message : "复制失败，请重试")); }}>复制</button>
    {/* WHY：朗读消费点击时已收到的文字快照，不等待或改写当前生成流。 */}
    <SpeechButton text={speechPlainText(readableAssistantText(message))} label="AI回答" />
    {feedback && <span className={styles.feedback} role="status">{feedback}</span>}
  </div>;
}
