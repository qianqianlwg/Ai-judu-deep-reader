'use client';
import type { ReadingAppearancePreferences } from '@/lib/reading-appearance';
import './reading-enhancement.css';
type Props={value:ReadingAppearancePreferences;onChange:(patch:Partial<ReadingAppearancePreferences>)=>void;disabled?:boolean};
export function ReadingEnhancementControl({value,onChange,disabled}:Props) {
  return <fieldset className="reading-enhancement-control" disabled={disabled}>
    <legend>阅读增强</legend>
    <p>关键词标黄 · 关键句下划线</p>
    <div className="enhancement-scope"><strong>原文</strong><div>
      <label><input type="checkbox" name="sourceTerms" checked={value.sourceTerms} onChange={e=>onChange({sourceTerms:e.target.checked})}/>关键词标黄</label>
      <label><input type="checkbox" name="sourceSentences" checked={value.sourceSentences} onChange={e=>onChange({sourceSentences:e.target.checked})}/>关键句下划线</label>
    </div></div>
    <div className="enhancement-scope"><strong>细分句读</strong><div>
      <label><input type="checkbox" name="semanticTerms" checked={value.semanticTerms} onChange={e=>onChange({semanticTerms:e.target.checked})}/>关键词标黄</label>
      <label><input type="checkbox" name="semanticSentences" checked={value.semanticSentences} onChange={e=>onChange({semanticSentences:e.target.checked})}/>关键句下划线</label>
    </div></div>
    <small>重点由 Agent 判断；开关仅控制显示，不额外调用模型。没有重点数据时可手动生成。适用于可映射文字的原版、精读和句读来源；扫描图片不增强。与已有概念、句读线和手动标注互不删除。颜色跟随重点配色。</small>
  </fieldset>;
}
