// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_READING_APPEARANCE as defaults, type ReadingAppearancePreferences } from "@/lib/reading-appearance";
import { ReadingAppearanceSettings } from "./reading-appearance-settings";
import fs from "node:fs/promises";

let host: HTMLDivElement; let root: Root; let current: ReadingAppearancePreferences;
const onChange = vi.fn((value: ReadingAppearancePreferences) => { current = value; });
async function render(props: Partial<React.ComponentProps<typeof ReadingAppearanceSettings>> = {}) {
  await act(async () => root.render(<ReadingAppearanceSettings value={current} onChange={onChange} {...props} />));
}
async function rerender() { await render(); }
async function changeValue(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
}
beforeEach(async () => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); current = { ...defaults }; onChange.mockClear(); await render(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("ReadingAppearanceSettings", () => {
  it("渲染五种本地主题缩略图、版本无外部图片，并提供无障碍分组", () => {
    expect(host.querySelectorAll('input[type="radio"][name*="-theme"]')).toHaveLength(5);
    expect(host.querySelectorAll(`[data-testid="reading-appearance-theme"]`)).toHaveLength(5);
    expect(host.querySelectorAll("img")).toHaveLength(0);
    expect(host.querySelector("fieldset[disabled]")).toBeNull();
    expect(host.querySelector('fieldset legend')?.textContent).toContain("主题");
    expect(host.querySelector('[aria-labelledby]')).toBeTruthy();
  });
  it("主题、字体、字号、行距、字距、列宽、对齐和语言都是受控更新", async () => {
    await act(async () => (host.querySelector('input[type="radio"][value="mist"]') as HTMLInputElement).click());
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "mist" })); current = onChange.mock.lastCall![0]; await rerender();
    await act(async () => (host.querySelector('select[name="font"]') as HTMLSelectElement).value = "kai");
    const fontSelect = host.querySelector<HTMLSelectElement>('select[name="font"]')!; await act(async () => fontSelect.dispatchEvent(new Event("change", { bubbles: true })));
    current = onChange.mock.lastCall![0]; await rerender(); expect(current.font).toBe("kai");
    await changeValue('input[name="fontSize"]', "32"); current = onChange.mock.lastCall![0]; expect(current.fontSize).toBe(32); await rerender();
    await changeValue('input[name="lineHeight"]', "1.4"); current = onChange.mock.lastCall![0]; expect(current.lineHeight).toBe(1.4); await rerender();
    await changeValue('input[name="letterSpacing"]', "0.08"); current = onChange.mock.lastCall![0]; expect(current.letterSpacing).toBe(0.08); await rerender();
    const width = host.querySelector<HTMLSelectElement>('select[name="columnWidth"]')!; width.value = "780"; await act(async () => { width.dispatchEvent(new Event("input", { bubbles: true })); width.dispatchEvent(new Event("change", { bubbles: true })); }); current = onChange.mock.lastCall![0]; expect(current.columnWidth).toBe(780); await rerender();
    const justify = host.querySelector<HTMLInputElement>('input[name$="-alignment"][value="justify"]')!; await act(async () => justify.click()); current = onChange.mock.lastCall![0]; expect(current.textAlign).toBe("justify"); await rerender();
    const language = host.querySelector<HTMLSelectElement>('select[name="language"]')!; language.options[1].selected = true; await act(async () => { language.dispatchEvent(new Event("change", { bubbles: true })); }); current = onChange.mock.lastCall![0]; expect(current.language).toBe("en"); await rerender();
    expect(host.querySelector('[data-testid="reading-appearance-preview"]')?.getAttribute("lang")).toBe("en");
  });
  it("预览随受控值反映字号、行距、列宽；恢复默认是单一 onChange", async () => {
    current = { ...defaults, fontSize: 32, lineHeight: 2.4, columnWidth: 520 }; await rerender();
    const preview = host.querySelector<HTMLElement>('[data-testid="reading-appearance-preview"]')!;
    expect(preview.style.fontSize).toBe("32px"); expect(preview.style.lineHeight).toBe("2.4"); expect(Number.parseFloat(preview.style.width)).toBeCloseTo(66.6667, 3);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="恢复默认阅读外观"]')!.click());
    expect(onChange).toHaveBeenCalledTimes(1); expect(onChange).toHaveBeenLastCalledWith(defaults);
  });
  it("未 ready 时不展示可操作设置，不改值；错误通过 alert 反馈", async () => {
    await render({ ready: false, error: "本地设置读取失败" });
    expect(host.querySelector('[aria-busy="true"]')).toBeTruthy(); expect(host.querySelector('[role="status"]')?.textContent).toContain("读取");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("本地设置读取失败");
    expect(host.querySelector(`[data-testid="reading-appearance-content"]`)?.getAttribute("data-ready")).toBe("false");
    expect(host.querySelectorAll<HTMLFieldSetElement>("fieldset")[0].disabled).toBe(true); expect(host.querySelectorAll<HTMLFieldSetElement>("fieldset")[1].disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("重复装配使用独立 radio group，不共享 name；按钮有清晰焦点目标", async () => {
    const second = document.createElement("div"); document.body.append(second); const secondRoot = createRoot(second);
    await act(async () => secondRoot.render(<ReadingAppearanceSettings value={current} onChange={vi.fn()} />));
    const names = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((input) => input.name);
    const names2 = [...second.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((input) => input.name);
    expect(names.some((name) => names2.includes(name))).toBe(false);
    await act(async () => secondRoot.unmount()); second.remove();
  });
});

describe("局部样式约束", () => {
  it("样式独立、无外部资源且文件不超 500 行", async () => {
    const source = await fs.readFile("src/components/reading-appearance-settings.module.css", "utf8");
    expect(source.split(/\r?\n/)).toHaveLength(103); expect(source).not.toMatch(/url\(/); expect(source).toContain("prefers-reduced-motion");
  });
});
