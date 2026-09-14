// @vitest-environment jsdom
import { expect, it } from "vitest";
import { createReaderMeasurement, readerContentBox } from "./reader-measurement";
it("正文测量扣除自身内边距而不是浏览器高度估算", () => {
  const el = document.createElement("div"); el.style.padding = "20px 30px 10px"; document.body.append(el);
  Object.defineProperties(el, { clientHeight: { value: 500 }, clientWidth: { value: 700 } });
  expect(readerContentBox(el)).toEqual({ width: 640, height: 470 }); el.remove();
});
it("测量层仅包含同样的标题及正文且可释放", () => {
  const m = createReaderMeasurement(620, 1.2);
  m.measure([{ id:"p", text:"正文", chapterId:"c", chapterTitle:"章" }], "章");
  const el = document.querySelector(".reader-measure-sheet")!;
  expect(el.querySelector("h1")?.textContent).toBe("章"); expect(el.querySelector("p")?.textContent).toBe("正文");
  m.dispose(); expect(document.querySelector(".reader-measure-sheet")).toBeNull();
});
