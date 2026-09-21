import { expect, it } from "vitest";
import { mobiPagebreakContexts } from "./mobi-pagebreak-context.mjs";

const contexts = (html: string) => {
  const matches = [...html.matchAll(/<\s*(?:mbp:)?pagebreak[^>]*>/giu)];
  return mobiPagebreakContexts(html, matches.map(match => ({
    start: match.index,
    end: match.index + match[0].length,
  })));
};

it("恢复嵌套祖先及安全属性，不把pagebreak自身当祖先", () => {
  const html = '<html><body><section class="chapter" lang="zh" dir="rtl"><div style="color:red"><p>一</p><mbp:pagebreak/><p>二</p></div></section></body></html>';
  expect(contexts(html)).toEqual([{ prefix: '<section class="chapter" lang="zh" dir="rtl"><div style="color:red">', suffix: "</div></section>", depth: 2 }]);
});

it("连续分页跳过上一个pagebreak解析容器，保持相同真实祖先", () => {
  const html = "<html><body><section><p>一</p><mbp:pagebreak/><p>二</p><mbp:pagebreak/><p>三</p></section></body></html>";
  expect(contexts(html)).toEqual([
    { prefix: "<section>", suffix: "</section>", depth: 1 },
    { prefix: "<section>", suffix: "</section>", depth: 1 },
  ]);
});

it("有序列表按分页前真实li/value继续序号", () => {
  expect(contexts('<html><body><ol start="4"><li>四</li><mbp:pagebreak/><li value="8">八</li><li>九</li><mbp:pagebreak/><li>十</li></ol></body></html>')).toEqual([
    { prefix: '<ol start="5">', suffix: "</ol>", depth: 1 },
    { prefix: '<ol start="10">', suffix: "</ol>", depth: 1 },
  ]);
});

it("列表项内部分页时续接项保留当前编号", () => {
  expect(contexts('<html><body><ol start="4"><li>前半<mbp:pagebreak/>后半</li><li>第五项</li></ol></body></html>')).toEqual([
    { prefix: '<ol start="4"><li>', suffix: "</li></ol>", depth: 2 },
  ]);
});

it("value、reversed和嵌套列表在项内分页时分别保留当前序号", () => {
  expect(contexts('<html><body><ol reversed><li value="7">甲<mbp:pagebreak/>乙</li><li>六</li></ol></body></html>')).toEqual([
    { prefix: '<ol reversed="" start="7"><li value="7">', suffix: "</li></ol>", depth: 2 },
  ]);
  expect(contexts('<html><body><ol start="2"><li>外层二<ol start="8"><li>内层八<mbp:pagebreak/>续文</li><li>内层九</li></ol></li><li>外层三</li></ol></body></html>')).toEqual([
    { prefix: '<ol start="2"><li><ol start="8"><li>', suffix: "</li></ol></li></ol>", depth: 4 },
  ]);
});

it("顶层分页无需合成包装，重复位置和伪标记拒绝", () => {
  expect(contexts("<html><body><p>一</p><mbp:pagebreak/><p>二</p></body></html>")).toEqual([{ prefix: "", suffix: "", depth: 0 }]);
  expect(() => mobiPagebreakContexts("<p>x</p>", [{ start: 0, end: 3 }])).toThrow("不一致");
});