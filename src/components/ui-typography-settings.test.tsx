// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { UI_TEXT_SIZE_KEY } from "@/lib/ui-typography";
import { UiTypographySettings } from "./ui-typography-settings";
let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear(); document.documentElement.style.removeProperty("--ui-text-size");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<UiTypographySettings />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("非正文字号可独立保存与恢复，不改正文排版变量", async () => {
  const input = host.querySelector<HTMLInputElement>('[aria-label="非正文字号"]')!;
  expect(input.value).toBe("13");
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(input, "18"); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(input.value).toBe("18"); expect(localStorage.getItem(UI_TEXT_SIZE_KEY)).toBe("18");
  expect(document.documentElement.style.getPropertyValue("--ui-text-size")).toBe("18px");
  expect(document.documentElement.style.getPropertyValue("--reading-font-size")).toBe("");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(input.value).toBe("13");
});
it("存储不可用时应用当前值但显示保存错误", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const input = host.querySelector<HTMLInputElement>('[aria-label="非正文字号"]')!;
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(input, "16"); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("未能保存");
  expect(document.documentElement.style.getPropertyValue("--ui-text-size")).toBe("16px");
});


it("重新挂载恢复保存的字号，存储读取失败时明确反馈", async () => {
  await act(async () => root.unmount()); root = createRoot(host);
  localStorage.setItem(UI_TEXT_SIZE_KEY, "17");
  await act(async () => root.render(<UiTypographySettings />));
  expect(host.querySelector<HTMLInputElement>("input")?.value).toBe("17");
  await act(async () => root.unmount()); root = createRoot(host);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await act(async () => root.render(<UiTypographySettings />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("无法读取界面字号");
});
