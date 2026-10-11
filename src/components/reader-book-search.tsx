"use client";
import { useEffect, useRef, useState } from "react";
import { searchParagraphs, type SearchMatch, type SearchParagraph } from "@/lib/book-search";
import type { SearchResult } from "./book-search-panel";
import styles from "./reader-book-search.module.css";

type Props = { paragraphs: SearchParagraph[]; disabled?: boolean; onResult(result: SearchResult): void };
export function ReaderBookSearch({ paragraphs, disabled = false, onResult }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchMatch[] | null>(null);
  const [visible, setVisible] = useState(30);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <div className={styles.search} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
    <button ref={trigger} type="button" disabled={disabled} aria-expanded={open} onClick={() => setOpen(value => !value)}>⌕ 搜索全书</button>
    {open && <section className={styles.panel} aria-label="全书内容搜索">
      <header><strong>搜索全书</strong><button type="button" aria-label="关闭全书搜索" onClick={close}>×</button></header>
      <form onSubmit={event => {
        event.preventDefault(); if (!query.trim() || disabled) return;
        // WHY：阅读搜索只查当前版本已导入的全文，不生成 AI 内容，也不发送原文到外部服务。
        setResults(searchParagraphs(paragraphs, query, paragraphs.length, 0)); setVisible(30);
      }}>
        <input ref={input} aria-label="全书搜索关键词" type="search" value={query} placeholder="输入本书原文关键词…"
          onChange={event => { setQuery(event.target.value); setResults(null); }} />
        <button type="submit" disabled={disabled || !query.trim() || !paragraphs.length}>搜索</button>
      </form>
      {!paragraphs.length ? <p role="status">本书没有可搜索的文字层，图片页或扫描件暂不支持全文搜索。</p>
        : results === null ? <p>查找全书原文，点击结果定位；关键词搜索仅在本机进行。</p>
        : <><p role="status">{results.length ? `找到 ${results.length} 段匹配原文` : "未找到匹配内容，请尝试其他关键词。"}</p>
          <div className={styles.results}>{results.slice(0, visible).map(result => {
            const offset = result.excerpt.toLocaleLowerCase().indexOf(result.matchedText.toLocaleLowerCase());
            return <button type="button" disabled={disabled} key={result.paragraphId} onClick={() => { onResult(result); close(); }}>
              <strong>{result.chapterTitle}</strong><span>{offset < 0 ? result.excerpt : <>{result.excerpt.slice(0, offset)}<mark>{result.excerpt.slice(offset, offset + result.matchedText.length)}</mark>{result.excerpt.slice(offset + result.matchedText.length)}</>}</span>
              <small>定位原文 ↗</small>
            </button>;
          })}</div>
          {visible < results.length && <button type="button" onClick={() => setVisible(value => value + 30)}>显示更多结果（剩余 {results.length - visible} 段）</button>}
        </>}
    </section>}
  </div>;
}
