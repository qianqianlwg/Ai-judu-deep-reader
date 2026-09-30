'use client';
import { Fragment, type ReactNode } from 'react';
import { sourceEmphasisSegments, type SourceEmphasisRange } from '@/lib/source-enhancement';
import './reading-enhancement.css';
export function SourceEnhancedText({text,start=0,ranges}:{text:string;start?:number;ranges:readonly SourceEmphasisRange[]}) {
  return <>{sourceEmphasisSegments(text,start,ranges).map((part,i)=>{let node:ReactNode=part.text;for(const kind of [...(part.kinds??(part.kind?[part.kind]:[]))].reverse())node=<span data-source-emphasis={kind}>{node}</span>;return <Fragment key={i}>{node}</Fragment>;})}</>;
}
export function EnhancedSourceExcerpt({text,ranges=[]}:{text:string;ranges?:readonly SourceEmphasisRange[]}) {
  return <SourceEnhancedText text={text} ranges={ranges}/>;
}
