// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SpeechPlaybackBar, SpeechProvider } from "./speech-controls";
import { IDLE_SPEECH_STATE, type SpeechState } from "@/lib/speech-player";
const harness=vi.hoisted(()=>({change:null as ((state:SpeechState)=>void)|null,pause:vi.fn(),resume:vi.fn(),stop:vi.fn()}));
vi.mock("@/lib/speech-player",async importOriginal=>{
 const actual=await importOriginal<typeof import("@/lib/speech-player")>();
 return {...actual,SpeechPlayer:class {constructor(options:{onChange:(state:SpeechState)=>void}){harness.change=options.onChange;}speak=vi.fn();stop=harness.stop;pause=harness.pause;resume=harness.resume;}};
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

it("朗读控制与页码显式装配在同一底栏，状态切换不新增布局行",async()=>{
 await act(()=>root.render(<SpeechProvider><nav className="epub-navigation"><button aria-label="选择页码跳转">7 / 13</button><SpeechPlaybackBar inline/></nav></SpeechProvider>));
 const nav=host.querySelector("nav")!;
 for(const value of ["idle","loading","playing","paused","error","idle"] as const){
  await phase(value,value==="error"?"错误".repeat(100):"");
  expect(nav.children).toHaveLength(2);expect(nav.querySelector('[data-inline="true"]')).not.toBeNull();
  expect(nav.querySelector('[aria-label="选择页码跳转"]')!.textContent).toBe("7 / 13");
 }
 await phase("playing");const pause=nav.querySelector<HTMLButtonElement>('[aria-label="暂停朗读"]')!;
 expect(pause.textContent).toBe("暂停");await act(()=>pause.click());expect(harness.pause).toHaveBeenCalled();
 await phase("paused");const play=nav.querySelector<HTMLButtonElement>('[aria-label="继续朗读"]')!;
 expect(play.textContent).toBe("播放");await act(()=>play.click());expect(harness.resume).toHaveBeenCalled();
 await act(()=>nav.querySelector<HTMLButtonElement>('[aria-label="停止朗读"]')!.click());expect(harness.stop).toHaveBeenCalled();
});
it("各格式阅读器共用同高底栏，长提示和窄窗口不能换行",async()=>{
 const css=await readFile("src/components/speech-controls.css","utf8");
 expect(css).toContain('height:40px; min-height:40px; max-height:40px; flex:0 0 40px');
 expect(css).toContain('speech-footer-inline[data-phase="idle"] { display:none; }');
 expect(css).toMatch(/speech-footer\.speech-footer-inline\s*\{[^}]*flex-wrap:nowrap[^}]*align-items:center/u);
 for(const name of ["epub-reader","pdf-reader","cbz-reader"]){expect(await readFile(`src/components/${name}.tsx`,"utf8")).toContain("<SpeechPlaybackBar inline/>");}
 const page=await readFile("src/app/page.tsx","utf8");expect(page).toContain("<SpeechPlaybackBar inline/>");expect(page).not.toContain("<SpeechPlaybackBar reserveSpace/>");
});

it("原版翻页使用两端箭头，中心页码与朗读保持轻量层级",async()=>{
 const source=await readFile("src/components/epub-reader.tsx","utf8");const css=await readFile("src/components/speech-controls.css","utf8");
 expect(source).toContain('aria-label={modeLabel+"上一页"}');expect(source).toContain('aria-label={modeLabel+"下一页"}');expect(source).toContain('className="epub-turn-label"');
 expect(css).toContain('grid-template-columns:32px minmax(0,1fr) 32px');expect(css).toContain('.workspace-shell .epub-book-progress::before { content:none; }');
});
