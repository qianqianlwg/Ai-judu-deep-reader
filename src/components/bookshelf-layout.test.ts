import {readFile} from 'node:fs/promises';import {expect,it} from 'vitest';
it('书架视口规则没有不可见BOM选择器，列表拥有独立滚动空间',async()=>{const css=await readFile(new URL('./bookshelf-home.css',import.meta.url),'utf8');expect(css).not.toContain('\uFEFF');expect(css).toContain('height:100dvh');expect(css).toContain('overflow:hidden');expect(css).toContain('flex-shrink:0');const shelf=await readFile(new URL('./bookshelf.css',import.meta.url),'utf8');expect(shelf).toContain('.bookshelf-scroll{flex:1;overflow:auto;min-height:0');});
it('目录宽度可变、标题可换行且深层视觉缩进有上限',async()=>{const css=await readFile(new URL('./workspace-nav.css',import.meta.url),'utf8');expect(css).not.toContain('\uFEFF');expect(css).toContain('var(--nav-panel-width,220px)');expect(css).toContain('padding-inline-start:8px');expect(css).toContain('white-space:normal');expect(css).toContain('[data-depth="5"]');});

it('拖宽目录后导读按自身可用宽度换行，工具栏不能被窗口宽度误判裁切',async()=>{
 const css=await readFile(new URL('./guide-workspace.module.css',import.meta.url),'utf8');expect(css).not.toContain('\uFEFF');expect(css).toContain('container-name:guide-workspace');expect(css).toContain('@container guide-workspace (max-width:1000px)');expect(css).toContain('.toolbar .tools{order:2;flex-wrap:wrap;');
});
