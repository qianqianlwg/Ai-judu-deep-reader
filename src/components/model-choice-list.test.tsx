// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelChoiceList } from "./model-choice-list";
import type { ModelChoice } from "@/lib/model-choices";
function Harness() { const [choices, setChoices] = useState<ModelChoice[]>([{ model: "GLM-4.6", enabled: true }]); return <ModelChoiceList choices={choices} onChange={setChoices} />; }
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it("adds editable model rows, toggles availability, and removes a custom model", async () => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root.render(<Harness />)); expect(host.querySelectorAll("[data-model-row]")).toHaveLength(1); await act(async () => host.querySelector<HTMLButtonElement>(`[data-testid="add-model"]`)!.click()); expect(host.querySelectorAll("[data-model-row]")).toHaveLength(2); const name = host.querySelector<HTMLInputElement>(`input[aria-label="Model name 2"]`)!; await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(name, "GLM-4.5"); name.dispatchEvent(new Event("input", { bubbles: true })); name.dispatchEvent(new Event("change", { bubbles: true })); }); expect(name.value).toBe("GLM-4.5"); const toggle = host.querySelector<HTMLInputElement>(`input[aria-label="Enable model 2"]`)!; await act(async () => toggle.click()); expect(toggle.checked).toBe(false); await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="Remove model 2"]`)!.click()); expect(host.querySelectorAll("[data-model-row]")).toHaveLength(1); });
it("shows an enabled-model count and prevents adding over the list limit", async () => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); const choices = Array.from({ length: 50 }, (_, index) => ({ model: "m" + index, enabled: index === 0 })); await act(async () => root.render(<ModelChoiceList choices={choices} onChange={vi.fn()} />)); expect(host.textContent).toContain("1 / 50"); expect(host.querySelector<HTMLButtonElement>(`[data-testid="add-model"]`)?.disabled).toBe(true); });
