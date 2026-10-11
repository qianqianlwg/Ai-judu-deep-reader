'use client';
import { useGuidePreparation,type GuidePreparationScope } from '@/hooks/use-guide-preparation';
import styles from './guide-preparation-status.module.css';
type Props={scope:GuidePreparationScope;onOpenGuide?:()=>void;disabled?:boolean};
export function GuidePreparationStatus({scope,onOpenGuide,disabled}:Props){
 const {state,error,busy,retry,refresh}=useGuidePreparation(scope);
 if(state?.status==='none')return null;
 const completed=state?.status==='completed',failed=state?.status==='failed',working=!completed&&!failed&&!error;
 const title=error?'整理状态暂不可用':failed?'本次思维导图整理未完成':completed?'思维导图已整理':state?.status==='waiting'?'等待本次句读完成':state?'正在整理本次句读思维导图…':'正在读取整理状态…';
 const action=completed&&onOpenGuide?'转到思维导图 ↗':failed?busy?'正在重试…':'重新整理':error?'重新读取':null;
 return <div className={styles.row+(working?' '+styles.working:'')} data-testid='guide-preparation-status' data-guide-status={state?.status??'loading'}>
  <span className={styles.label} role='status' title={error||state?.error||title}>{title}</span>
  {action&&<><span aria-hidden='true'>·</span><button type='button' disabled={busy||disabled} onClick={()=>{if(completed)onOpenGuide?.();else if(failed)void retry();else refresh();}}>{action}</button></>}
 </div>;
}
