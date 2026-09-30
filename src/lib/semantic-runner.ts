import { anchorParts, joinAnchorText } from './reading-anchors';
import { semanticSummary, type SemanticReading, type SemanticUnit } from './semantic-reading';
import type { Analysis } from './chat-stream';
import type { TokenUsage } from './token-usage';
export type SemanticRunnerDependencies = {
 readingStyle?: 'semantic'|'whole'; previous?: SemanticReading; signal:AbortSignal; plan:()=>Promise<SemanticUnit[]>;
 read:(unit:SemanticUnit,onText:(text:string)=>void)=>Promise<{text:string;analysis:Analysis;usage?:TokenUsage}>;
 publish:(state:SemanticReading,content:string)=>void;
 commit:(unit:SemanticUnit,state:SemanticReading)=>void;
};
// WHY：把计划/恢复/逐块提交独立于模型和数据库，失败不重跑已完成块，也不把略过算成解释完成。
export async function runSemanticUnits(d:SemanticRunnerDependencies):Promise<SemanticReading>{
 const state:SemanticReading=d.previous?structuredClone(d.previous):{version:1,readingStyle:d.readingStyle??'semantic',phase:'planning',units:[]};
 const publish=()=>d.publish(structuredClone(state),semanticSummary(state));
 try {
  if(!state.units.length){state.phase='planning';publish();state.units=await d.plan();d.signal.throwIfAborted();}
  state.phase='reading';publish();
  for(const unit of state.units){
   d.signal.throwIfAborted();if(unit.status==='completed'||unit.status==='skipped')continue;
   unit.status='streaming';unit.content='';delete unit.error;publish();
   try {
    const result=await d.read(unit,text=>{unit.content=text;publish();});d.signal.throwIfAborted();
    if(!result.text.trim())throw new Error('模型没有返回本块释读');
    unit.content=result.text;unit.analysis=result.analysis;unit.usage=result.usage;unit.status='completed';
    d.commit(unit,structuredClone(state));publish();
   } catch(error:unknown){unit.status='error';unit.error=d.signal.aborted?'已停止，可继续此块。':error instanceof Error?error.message:'本块未完成';throw error;}
  }
  state.phase='completed';publish();return state;
 } catch(error:unknown){state.phase='interrupted';publish();throw error;}
}
export function semanticUnitText(unit:SemanticUnit):string{return joinAnchorText(anchorParts(unit.anchor));}
