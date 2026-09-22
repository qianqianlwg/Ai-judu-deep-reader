// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {it,expect,vi} from "vitest";
import {useBookshelfAssistant} from "./use-bookshelf-assistant";
it("默认收起，用户展开后重挂载恢复，阅读会话存储不受影响",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);localStorage.clear();localStorage.setItem("judu:thread:book:v","conversation");
 const host=document.createElement("div");let root=createRoot(host);
 function View(){const state=useBookshelfAssistant();return <button onClick={state.toggle}>{String(state.open)}</button>;}
 try {await act(async()=>root.render(<View/>));expect(host.textContent).toBe("false");await act(async()=>host.querySelector("button")!.click());expect(host.textContent).toBe("true");act(()=>root.unmount());root=createRoot(host);await act(async()=>root.render(<View/>));expect(host.textContent).toBe("true");expect(localStorage.getItem("judu:thread:book:v")).toBe("conversation");}
 finally {act(()=>root.unmount());localStorage.clear();vi.unstubAllGlobals();}
});
