// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {epubDocumentContentElements} from './epub-content-elements';
it('标准标题与独立div文本块按原书顺序收录，不猜div标题层级',()=>{
 document.body.innerHTML='<div><h2>章标题</h2><h3>导言</h3><div class="ht4fc">一 泛论逻辑</div><p>正文<span>强调</span></p></div>';
 expect(epubDocumentContentElements(document).map(node=>[node.localName,node.textContent])).toEqual([['h2','章标题'],['h3','导言'],['div','一 泛论逻辑'],['p','正文强调']]);
});
it('不重复包装层、列表内段落及装饰，也不为图片生成原文',()=>{
 document.body.innerHTML='<section><div><div>独立文本</div></div><blockquote><p>引文</p></blockquote><li><p>列表</p></li><script>假标题</script><div data-judu-decoration>按钮</div><div><img alt="不可冒充OCR"/></div></section>';
 expect(epubDocumentContentElements(document).map(node=>node.textContent)).toEqual(['独立文本','引文','列表','']);
});
