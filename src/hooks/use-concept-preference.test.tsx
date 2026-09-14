// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import {setConceptPreference,useConceptPreference} from "./use-concept-preference";
function View(){return <span>{String(useConceptPreference())}</span>;}
it("概念默认开启，开关持久化并通知当前页",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);localStorage.removeItem("judu:showConcepts");const el=document.createElement("div");document.body.append(el);const root=createRoot(el);
 try{await act(async()=>root.render(<View/>));expect(el.textContent).toBe("true");await act(async()=>setConceptPreference(false));expect(el.textContent).toBe("false");expect(localStorage.getItem("judu:showConcepts")).toBe("false");}
 finally{await act(async()=>root.unmount());el.remove();localStorage.removeItem("judu:showConcepts");vi.unstubAllGlobals();}
});
