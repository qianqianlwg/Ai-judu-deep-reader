// @vitest-environment jsdom
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { externalSources } from "@/lib/agent/external-search";
describe("外部授权控件来源", () => { it("首批三路互补来源", () => expect(externalSources).toEqual(["openalex", "crossref", "web"])); });


// WHY：权限正文保留可查，但默认收起，选项菜单不被长说明挤满。
import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { ExternalPermissionsMenu } from "./external-permissions";
it("外部资料说明可展开，来源开关仍显示", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ available: { openalex: true, crossref: true, web: true } })));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ExternalPermissionsMenu permissions={{ openalex: true, crossref: true, web: true }} onChange={vi.fn()} disabled={false} />));
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    const detail = host.querySelector("details")!;
    expect(detail.open).toBe(false);
    expect(detail.textContent).toContain("不外发整段选文");
    await act(async () => detail.querySelector("summary")!.click());
    expect(detail.open).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
