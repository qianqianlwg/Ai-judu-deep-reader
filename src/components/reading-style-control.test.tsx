// @vitest-environment jsdom
import {afterEach,describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReadingStyleControl} from './reading-style-control';
import {readReadingStyle} from '@/lib/semantic-reading';
afterEach(()=>localStorage.clear());
describe('句读方式选项',()=>{it('默认按句意细读，同时保留原有模式',()=>{const html=renderToStaticMarkup(<ReadingStyleControl value={readReadingStyle(null)} onChange={()=>{}}/>);expect(html).toContain('value="semantic" selected');expect(html).toContain('整段句读');expect(html).toContain('aria-label="句读方式"');});});
