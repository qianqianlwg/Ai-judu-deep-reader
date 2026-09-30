// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsSidebar, type SettingsSectionId } from "./settings-sidebar";

let host: HTMLDivElement;
let root: Root;
const render = async (activeSection: SettingsSectionId = "appearance", query = "") => {
  await act(async () => root.render(<SettingsSidebar activeSection={activeSection} query={query} onQueryChange={vi.fn()} onSelect={vi.fn()} />));
};

describe("SettingsSidebar", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("按 Codex 风格分组展示设置并标记当前项", async () => {
    await render("appearance");
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain("外观");
    expect(host.textContent).toContain("AI 句读");
    expect(host.textContent).toContain("向量索引与检索");
  });

  it("搜索时只保留匹配的设置项", async () => {
    await render("appearance", "语音");
    expect(host.textContent).toContain("语音朗读");
    expect(host.textContent).not.toContain("向量索引与检索");
  });
});
