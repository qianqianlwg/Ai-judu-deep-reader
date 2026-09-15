// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ReadingMarksPanel } from "./reading-marks-panel";
let root: Root; let host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.restoreAllMocks(); });
it("reads mark cards and locates source", async () => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const open = vi.fn(); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ marks: [{ id: "m1", editionId: "e1", kind: "note", color: "yellow", note: "my question", anchors: [{ paragraphId: "p1", startOffset: 2, endOffset: 6, selectedText: "source fragment", textHash: "a".repeat(64) }], createdAt: "2026-01-01", updatedAt: "2026-01-01" }] })));
  await act(async () => root.render(<ReadingMarksPanel editionId="e1" onOpenSource={open} />)); await act(async () => { await Promise.resolve(); });
  expect(host.textContent).toContain("my question"); await act(async () => host.querySelector("button")?.click()); expect(open).toHaveBeenCalledWith({ paragraphId: "p1", startOffset: 2, endOffset: 6, selectedText: "source fragment" });
});
