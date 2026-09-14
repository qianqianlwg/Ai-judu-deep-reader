import { describe, expect, it } from "vitest";
import { collapseButtonState, paneScrollPolicy } from "./reader-layout";

describe("reader layout", () => {
  it("exposes an accessible state for collapsible shelf and toc", () => {
    expect(collapseButtonState(true, "书架")).toEqual({ expanded: true, label: "折叠书架", symbol: "−" });
    expect(collapseButtonState(false, "目录")).toEqual({ expanded: false, label: "展开目录", symbol: "＋" });
  });

  it("keeps the three desktop panes independent", () => {
    expect(paneScrollPolicy()).toEqual({ shelf: "independent", reading: "fixed", chat: "independent" });
  });
});
