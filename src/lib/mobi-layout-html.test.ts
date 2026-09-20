import { expect, it } from "vitest";
import { indexMobiLayout } from "./mobi-layout-html.mjs";
it("布局只核对唯一目标元素，不执行任意CSS选择器", () => {
  const index=indexMobiLayout('<h1 id="目标😀">章</h1><p aid="42">文</p><a href="filepos:123">引用</a>');
  expect(index.hrefs).toEqual(["filepos:123"]);expect(index.resolve('[id="目标😀"]')).toEqual({attribute:"id",value:"目标😀"});expect(index.resolve('[aid="42"]')).toEqual({attribute:"aid",value:"42"});
  for(const selector of ['body','[id="missing"]','[id="目标😀"],script','[onclick="evil"]'])expect(index.resolve(selector)).toBeNull();
});
it("重复id、script中的伪锚点、缺失目标均不能核准", () => {
  const index=indexMobiLayout('<p id="duplicate">一</p><p id="duplicate">二</p><script id="inert">throw new Error("x")</script><template><a href="hidden">x</a></template>');
  expect(index.resolve('[id="duplicate"]')).toBeNull();expect(index.resolve('[id="inert"]')).toBeNull();expect(index.hrefs).toEqual([]);
});
it("实体只解码一次，外链只采集不请求", () => {
  const index=indexMobiLayout('<a href="https://invalid.example/?a=1&amp;b=2">x</a><p name="&amp;lt;">文</p>');
  expect(index.hrefs).toEqual(['https://invalid.example/?a=1&b=2']);expect(index.resolve('[name="&lt;"]')).toEqual({attribute:'name',value:'&lt;'});
});
