import {expect,it} from 'vitest';
import {projectEpubContent} from './epub-content-projection';
const clean=(value:string)=>value.replace(/<[^>]*>/gu,' ').replace(/\s+/gu,' ').trim();
it('保留非标准小标题且保存旧h/p投影，用边界位置区分同文块',()=>{
 const projection=projectEpubContent('<h2>章标题</h2><div class="ht4fc">同文</div><p>同文</p><h3>后标题</h3>',clean);
 expect(projection.blocks.map(b=>[b.text,b.kind,b.headingLevel,b.sourceOrdinal])).toEqual([['章标题','heading',2,0],['同文','paragraph',undefined,1],['同文','paragraph',undefined,2],['后标题','heading',3,3]]);
 expect(projection.legacyBlocks.map(b=>b.text)).toEqual(['章标题','同文','后标题']);expect(projection.legacySourceOrdinals).toEqual([0,null,1,2]);
});
it('空元素参与真实次序，但噪声不产生来源；列表保持旧原文整体',()=>{
 const result=projectEpubContent('<p></p><div><h1>章</h1><blockquote><p>引文</p></blockquote><div>文本</div></div><script>噪声</script>',clean);
 expect(result.blocks.map(b=>[b.text,b.sourceOrdinal])).toEqual([['章',1],['引文',2],['文本',3]]);expect(result.legacySourceOrdinals).toEqual([1,2,null]);
});
it('仅div的旧单块投影可原样复用，不把多个div猜成一个旧锚点',()=>{
 expect(projectEpubContent('<div>原文</div>',clean).legacySourceOrdinals).toEqual([0]);
 const multiple=projectEpubContent('<div>甲</div><div>乙</div>',clean);expect(multiple.legacyBlocks[0].text).toBe('甲 乙');expect(multiple.legacySourceOrdinals).toEqual([null,null]);
});
