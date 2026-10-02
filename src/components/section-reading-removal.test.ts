import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';

it('阅读组合根和原版渲染器不再装配本节句读入口', async () => {
 const page=await readFile('src/app/page.tsx','utf8');
 const original=await readFile('src/components/epub-reader.tsx','utf8');
 expect(page).not.toMatch(/SectionReadingAction|onStartSection|onOpenSection|openSectionHistory/u);
 expect(original).not.toMatch(/EpubSectionActions|onStartSection|onOpenSection|sectionReadingDisabled/u);
 // WHY：取消的是整节快捷入口，不能误删选文句读与按来源打开既有历史的能力。
 expect(page).toContain('<SelectionActions');
 expect(original).toContain('<EpubInteractionLayer');
 expect(original).toContain('onOpenAnnotation');
});
it('移除专用浮窗样式和章首的按钮预留宽度',async()=>{
 for(const path of ['src/components/semantic-reading.css','src/components/reading-options.css','src/components/epub-reader.css']){
  const css=await readFile(path,'utf8');expect(css).not.toMatch(/section-action-wrap|epub-section-action|section-history-menu|section-native-dialog|section-scope-card/u);
 }
 expect(await readFile('src/components/semantic-reading.css','utf8')).not.toContain('padding-right:108px');
});
