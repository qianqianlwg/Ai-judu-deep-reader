import { describe, expect, it } from "vitest";
import { mobiHtmlBlocks } from "./mobi-html.mjs";

describe("候选worker HTML投影", () => {
  it("内联概念不插入伪空格，保留段落/子标题和同名正文", () => {
    expect(mobiHtmlBlocks('<h1>标题</h1><p>标题</p><p>认识<strong>财政</strong>体制。</p><h2>第二部分</h2><p>文本<br>换行</p>')).toEqual({ heading: "标题", paragraphs: ["标题", "认识财政体制。", "第二部分", "文本 换行"] });
  });
  it("实体只解码一次，emoji和字面量尖括号保留", () => {
    expect(mobiHtmlBlocks('<p>&lt;x&gt; &amp;lt; &amp;#65; &#x1f600;</p>').paragraphs).toEqual(['<x> &lt; &#65; 😀']);
  });
  it("脚本样式模板不执行、不作正文，图片/外链不触发网络", () => {
    expect(mobiHtmlBlocks('<html><head><title>元数据</title><style>.x{}</style></head><body><script>throw 1</script><template>秘密</template><noscript>备用</noscript><svg>装饰</svg><p>正文<a href="https://invalid.example">链接</a></p><img src="https://invalid.example/image"/></body></html>')).toEqual({ heading: '', paragraphs: ['正文链接'] });
  });
  it("嵌套块只出现一次，保留裸文本及表格单元间隔", () => {
    expect(mobiHtmlBlocks('开头<div>甲<p>乙</p>丙</div><table><tr><td>一</td><td>二</td></tr></table>结尾').paragraphs).toEqual(['开头','甲','乙','丙','一 二','结尾']);
  });
  it("64K未闭合标签不走回溯正则", () => {
    const value = '<'.repeat(64000); expect(mobiHtmlBlocks('<p>'+value+'</p>').paragraphs).toEqual([value]);
  });
  it("超限输入与海量空节点均拒绝", () => {
    expect(()=>mobiHtmlBlocks('x'.repeat(20_000_001))).toThrow('超限');
    expect(()=>mobiHtmlBlocks('<i></i>'.repeat(200_001))).toThrow('超限');
  }, 10000);
});
