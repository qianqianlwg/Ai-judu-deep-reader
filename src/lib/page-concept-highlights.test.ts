import { describe, expect, it } from "vitest";
import { pageConceptHighlights } from "./page-concept-highlights";
import type { ConceptDetail, TextAnnotation } from "./annotations";

const concepts: ConceptDetail[] = [
  { name: "\u7406\u6027", text: "\u5b9a\u4e49" },
  { name: "\u7ecf\u9a8c", text: "\u5b9a\u4e49" },
];
function slice(paragraphId: string, text: string, sourceText = text, sourceStartOffset = 0) {
  const annotation: TextAnnotation = {
    id: "analysis-" + paragraphId, paragraphId, startOffset: 0, endOffset: sourceText.length,
    textHash: "h", threadId: "t", kind: "analysis", summary: "",
    concepts: concepts.map((item) => item.name), conceptDetails: concepts, createdAt: "now",
  };
  return { paragraphId, text, sourceText, sourceStartOffset, sourceEndOffset: sourceStartOffset + text.length, annotations: [annotation], bookConcepts: concepts, showConcepts: true };
}

describe("\u53e5\u8bfb\u6982\u5ff5\u6309\u672c\u6bb5\u8303\u56f4\u9ad8\u4eae", () => {
  it("same-name terms remain available at each original location, including within one paragraph", () => {
    const page = pageConceptHighlights([slice("p1", "\u7406\u6027\u7406\u6027\u7ecf\u9a8c"), slice("p2", "\u7ecf\u9a8c\u7406\u6027")]);
    expect([...page.get("p1")!]).toEqual([0, 2, 4]);
    expect([...page.get("p2")!]).toEqual([0, 2]);
  });
  it("pagination keeps original paragraph offsets", () => {
    const full = "\u7406\u6027\u4e4b\u540e\u7406\u6027";
    const page = pageConceptHighlights([slice("p", full.slice(4), full, 4)]);
    expect([...page.get("p")!]).toEqual([4]);
  });
  it("a repeated same-name term outside the annotation anchor is not highlighted", () => {
    const full = "\u7406\u6027\u7406\u6027";
    const local: TextAnnotation = { id: "a", paragraphId: "p", startOffset: 0, endOffset: 2, textHash: "h", threadId: "t", kind: "analysis", summary: "", concepts: ["\u7406\u6027"], conceptDetails: [{ name: "\u7406\u6027", text: "\u5b9a\u4e49" }], createdAt: "now" };
    const page = pageConceptHighlights([{ ...slice("p", full), annotations: [local] }]);
    expect([...page.get("p")!]).toEqual([0]);
  });
  it("book dictionary without a local annotation creates no highlight entry", () => {
    const page = pageConceptHighlights([{ paragraphId: "p", text: "\u7406\u6027", annotations: [], bookConcepts: concepts, showConcepts: true }]);
    expect([...page.get("p")!]).toEqual([]);
  });
  it("disabled concepts produce no highlight entries", () => {
    expect([...pageConceptHighlights([{ ...slice("p", "\u7406\u6027"), showConcepts: false }]).get("p")!]).toEqual([]);
  });
});

it("同段不同句读块的同名词均可标亮，重读只保留同词位一个入口", () => {
  const text = "理性。理性", base = slice("p", text);
  const first = { ...base.annotations[0], id: "a", messageId: "unit-a", endOffset: 2 };
  const second = { ...first, id: "b", messageId: "unit-b", startOffset: 3, endOffset: 5 };
  const reread = { ...first, id: "c", messageId: "unit-c", createdAt: "2026-10-02" };
  expect([...pageConceptHighlights([{ ...base, annotations: [first, second, reread] }]).get("p")!]).toEqual([0, 3]);
});
it("概念被其他标注边界切开时每个片段均保留入口，不丢跨页后半词", () => {
  const base = slice("p", "理性"), edge = { ...base.annotations[0], id: "edge", startOffset: 1, endOffset: 2, concepts: [], conceptDetails: [] };
  expect([...pageConceptHighlights([{ ...base, annotations: [...base.annotations, edge] }]).get("p")!]).toEqual([0, 1]);
});
