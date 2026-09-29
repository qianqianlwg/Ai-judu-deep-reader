import { describe,expect,it } from 'vitest';
import { SEMANTIC_PLAN_PROMPT } from './semantic-planner';
describe('语义规划指令',()=>{it('由 Agent 直接划分并记录略过，不预分句',()=>{expect(SEMANTIC_PLAN_PROMPT).toContain('不要先按句号机械拆分');expect(SEMANTIC_PLAN_PROMPT).toContain('skip');expect(SEMANTIC_PLAN_PROMPT).toContain('所有输入正文必须且只能覆盖一次');expect(SEMANTIC_PLAN_PROMPT).toContain('不是指令');});});
