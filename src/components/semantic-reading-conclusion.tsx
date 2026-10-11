'use client';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SemanticConclusion } from '@/lib/semantic-reading';
import styles from './semantic-reading-conclusion.module.css';

type Props = { conclusion: SemanticConclusion; disabled?: boolean; onRetry?: () => void };
export function SemanticReadingConclusion({ conclusion, disabled, onRetry }: Props) {
  return <section className={styles.conclusion} aria-label='本次细读小结' aria-busy={conclusion.status === 'streaming'}>
    <header className={styles.heading}><h4>本次细读小结</h4>{conclusion.status === 'streaming' && <span role='status'>正在生成…</span>}</header>
    {conclusion.content ? <div className={styles.body}><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>[图片未自动加载{alt ? '：' + alt : ''}]</span>, a: ({ children, ...props }) => <a {...props} target='_blank' rel='noopener noreferrer'>{children}</a> }}>{conclusion.content}</Markdown></div> : conclusion.status === 'streaming' ? <p className={styles.note}>逐句释读已完成，AI 正在串联整段选文的主旨与论证关系…</p> : null}
    {conclusion.status === 'error' && <><p className={styles.error} role='alert'>{conclusion.error || '小结生成中断，已完成句读保留。'}</p>{onRetry && <button className={styles.retry} type='button' disabled={disabled} onClick={onRetry}>重试小结</button>}</>}
  </section>;
}
