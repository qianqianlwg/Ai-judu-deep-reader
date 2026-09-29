import {describe,expect,it} from 'vitest';
import {addSemanticUsage} from './semantic-flow';
const usage={inputTokens:10,outputTokens:5,totalTokens:15,contextTokens:15,contextWindow:1000,source:'provider' as const};
describe('多块用量',()=>{it('累计费用但保留当前窗口，不冒充精确统计',()=>{expect(addSemanticUsage(usage,usage)).toMatchObject({totalTokens:30,contextTokens:15});expect(addSemanticUsage({...usage,source:'estimated'},usage).source).toBe('estimated');});});
