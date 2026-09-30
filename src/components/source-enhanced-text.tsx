'use client';
import { sourceEmphasisSegments, type SourceEmphasisRange } from '@/lib/source-enhancement';
import './reading-enhancement.css';
export function SourceEnhancedText({text,start=0,ranges}:{text:string;start?:number;ranges:readonly SourceEmphasisRange[]}) {
  return <>{sourceEmphasisSegments(text,start,ranges).map((part,i)=>part.kind?<span key={i} data-source-emphasis={part.kind}>{part.text}</span>:part.text)}</>;
}
export function EnhancedSourceExcerpt({text,ranges=[]}:{text:string;ranges?:readonly SourceEmphasisRange[]}) {
  return <SourceEnhancedText text={text} ranges={ranges}/>;
}
