// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { describe, expect, it, expectTypeOf } from 'vitest';
import type { FoliateView, FoliateBook, FoliateLoadDetail } from './foliate-types';

describe('pinned foliate narrow contract', () => {
  it('exposes required section href IDs and canonical renderer/CFI APIs', () => {
    expectTypeOf<FoliateBook['sections'][number]['id']>().toEqualTypeOf<string>();
    expectTypeOf<FoliateView['renderer']['goTo']>().parameter(0).toEqualTypeOf<{ index: number; anchor: (doc: Document) => Range | Element }>();
    expectTypeOf<FoliateView['renderer']['setStyles']>().parameter(0).toEqualTypeOf<string>();
    expectTypeOf<FoliateLoadDetail>().toEqualTypeOf<{ doc: Document; index: number }>();
    expectTypeOf<FoliateView['getCFI']>().returns.toEqualTypeOf<string>();
  });
  it('uses script-disabled iframe sandboxing in both renderer implementations', async () => {
    for (const name of ['paginator', 'fixed-layout']) {
      const code = await readFile(`public/vendor/foliate/${name}.js`, 'utf8');
      expect(code).toContain("setAttribute('sandbox', 'allow-same-origin')");
      expect(code).not.toContain("'allow-same-origin allow-scripts'");
    }
  });
});

// WHY：开发工具不应改变产品的文档运输或上游组件封装。
it('keeps native blob loading and upstream closed shadow roots', async () => {
  for (const name of ['view', 'paginator', 'fixed-layout']) {
    const source=await readFile(`public/vendor/foliate/${name}.js`,'utf8');
    expect(source).toContain("attachShadow({ mode: 'closed' })");
    expect(source).not.toContain("attachShadow({ mode: 'open' })");
    expect(source).not.toContain('srcdoc');expect(source).not.toContain('this.documentSource');
    expect(source).not.toContain('Element.prototype');
  }
  const bridge=await readFile('public/vendor/foliate/bridge.js','utf8');
  expect(bridge).not.toContain('srcdoc');expect(bridge).not.toContain('documentSources');
});
