// @vitest-environment jsdom
import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {EpubSectionActions} from './epub-section-actions';
it('无可靠标题坐标时不猜测插入按钮',()=>{expect(renderToStaticMarkup(<EpubSectionActions host={{current:null}} documents={[]} book={{id:'b',title:'书',author:'作者',chapters:[]}} changes={new EventTarget()} onStart={()=>{}}/>)).toBe('');});
