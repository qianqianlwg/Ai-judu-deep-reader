import { anchorParts } from './reading-anchors';
import type { SemanticReading } from './semantic-reading';
export function semanticProgress(state:SemanticReading){
  const done=state.units.filter(u=>u.status==='completed');
  const count=(units:SemanticReading['units'])=>units.reduce((n,u)=>n+anchorParts(u.anchor).reduce((m,p)=>m+Array.from(p.selectedText).length,0),0);
  const processed=count(done),total=state.totalCharacters??count(state.units);
  const thought=state.thinkingCompleted??(state.phase==='reading'||state.phase==='completed'||state.units.length>0);
  // WHY：只统计校验并提交完成的原文字符，pending、错误和略过不冒充已句读；新增协议完整覆盖才能到100%。
  const percent=thought ? Math.min(100,10+90*(total>0?Math.min(processed,total)/total:0)) : 0;
  return {completed:done.length,processed,total,percent,thinkingCompleted:thought};
}
