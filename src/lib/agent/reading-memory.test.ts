import { describe, expect, it } from "vitest";
import { decodeMemoryCheckpoint } from "./reading-memory";
import { emptyMemory, memoryChecksum, renderMemory } from "../context-memory";
describe("持久化阅读记忆校验",()=>{
  it("摘要、字段与校验匹配才可恢复",async()=>{const state={...emptyMemory(),task:"阅读目标",constraints:["中文回答"]};const summary=renderMemory(state),ids=["m1"];const value={version:1,previousVersion:null,sourceMessageIds:ids,summary,state,sourceChecksum:await memoryChecksum([{id:"m1",role:"user",content:"中文回答"}]),checksum:await memoryChecksum({summary,state,ids}),createdAt:"2026-01-01"};expect(await decodeMemoryCheckpoint(JSON.stringify(value))).toEqual(value);expect(await decodeMemoryCheckpoint(JSON.stringify({...value,summary:"被替换的记忆"}))).toBeUndefined();});
  it("不把旧的空记录或损坏JSON当成新检查点",async()=>{expect(await decodeMemoryCheckpoint(null)).toBeUndefined();expect(await decodeMemoryCheckpoint("{}")).toBeUndefined();expect(await decodeMemoryCheckpoint("{" )).toBeUndefined();});
});
