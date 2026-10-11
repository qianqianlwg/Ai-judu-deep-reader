// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SpeechPlaybackBar, SpeechProvider } from "./speech-controls";
import { IDLE_SPEECH_STATE, type SpeechState } from "@/lib/speech-player";
const harness=vi.hoisted(()=>({change:null as ((state:SpeechState)=>void)|null}));
vi.mock("@/lib/speech-player",async importOriginal=>{
 const actual=await importOriginal<typeof import("@/lib/speech-player")>();
 return {...actual,SpeechPlayer:class {constructor(options:{onChange:(state:SpeechState)=>void}){harness.change=options.onChange;}speak=vi.fn();stop=vi.fn();pause=vi.fn();resume=vi.fn();}};
});
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(reserveSpace=true){await act(()=>root.render(<SpeechProvider><div className="workspace-main"><article>正文区域</article><SpeechPlaybackBar reserveSpace={reserveSpace}/></div></SpeechProvider>));}
async function phase(value:SpeechState["phase"],error=""){await act(()=>harness.change!({...IDLE_SPEECH_STATE,phase:value,label:"选中文字",error}));}
it("阅读页空闲时保留隐藏的同一底部槽，播放和停止都不新增或删除布局行",async()=>{
 await render();const slot=host.querySelector(".speech-footer")!;expect(slot.getAttribute("data-phase")).toBe("idle");expect(slot.getAttribute("aria-hidden")).toBe("true");
 for(const value of ["loading","playing","paused","idle"] as const){await phase(value);expect(host.querySelectorAll(".speech-footer")).toHaveLength(1);expect(host.querySelector(".speech-footer")!.getAttribute("data-reserve-space")).toBe("true");expect(host.querySelector(".workspace-main")!.children).toHaveLength(2);}
});
it("错误在固定槽内明确显示，不增加额外布局行",async()=>{
 await render();await phase("error","请配置密钥。".repeat(40));const slot=host.querySelector(".speech-footer")!;
 expect(slot.querySelector('[role="alert"]')!.textContent).toBe("请配置密钥。".repeat(40));expect(slot.querySelector('[role="alert"]')!.parentElement!.className).toBe("speech-footer-info");expect(host.querySelectorAll(".speech-footer")).toHaveLength(1);
 expect(Array.from(slot.querySelectorAll("button")).map(button=>button.textContent)).toContain("关闭朗读提示");
});
it("非阅读上下文默认仍在空闲时隐藏播放器",async()=>{await render(false);expect(host.querySelector(".speech-footer")).toBeNull();});
it("所有状态与移动端共用52px固定槽，错误内容可滚动而非挤压正文",async()=>{
 const css=await readFile("src/components/speech-controls.css","utf8");
 expect(css).toContain('grid-template-rows:minmax(0,1fr) 52px');expect(css).toContain('height:52px; min-height:52px; max-height:52px');expect(css).toContain('[data-phase="idle"] { visibility:hidden; }');
 expect(css).toMatch(/speech-footer-info\s*\{[^}]*max-height:36px; overflow:auto/u);expect(css).not.toMatch(/position\s*:\s*(fixed|absolute)/u);
});
