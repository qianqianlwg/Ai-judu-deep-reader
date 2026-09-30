import {expect,it} from 'vitest';
import {decodeSemanticPlan,SemanticPlanError} from './semantic-plan-input';
it('合法二次JSON仅解码，损坏内容不修补',()=>{expect(decodeSemanticPlan({units:'[{"label":"合法"}]'})).toEqual({units:[{label:'合法'}]});expect(()=>decodeSemanticPlan({units:'broken'})).toThrow('JSON 数组');expect(new SemanticPlanError('失败').code).toBe('semantic_plan_invalid');});
