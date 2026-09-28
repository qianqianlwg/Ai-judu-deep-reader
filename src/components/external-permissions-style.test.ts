import {readFile} from "node:fs/promises";import {expect,it} from "vitest";
it("外部来源菜单列表仅使用紧凑视觉层，不引入权限业务",async()=>{const css=await readFile("src/components/external-permissions.module.css","utf8");expect(css).toContain("font-size: 12px");expect(css).toContain("min-height: 42px");expect(css).toContain(".disclosure");});
