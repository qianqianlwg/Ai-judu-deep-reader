import {readFile} from "node:fs/promises";import {expect,it} from "vitest";
it("聊天辅助层小于正文且菜单宽度紧凑",async()=>{
 const panel=await readFile("src/components/analysis-panel.module.css","utf8"),menu=await readFile("src/components/composer-options.module.css","utf8"),actions=await readFile("src/components/message-actions.module.css","utf8");
 expect(panel).toContain("font-size: max(15px");expect(panel).toContain("composerInput::placeholder { font-size: 13px;");expect(menu).toContain("width: min(288px");expect(actions).toContain(".actions button{font-size:10px;}");
});
