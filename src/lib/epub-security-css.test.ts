import { describe, it, expect } from 'vitest';
import { sanitizeCss } from '../../public/vendor/foliate/security-css.js';

describe('pinned CSS sanitizer', () => {
  it('retains readable layout, local images/fonts and inert text but drops import and dynamic image functions', async () => {
    const result = await sanitizeCss(`@import '/api/private'; @font-face{font-family:Book;src:url('../fonts/book.woff2') format('woff2')}
      p{color:red;margin:calc(1em + 2px);background:url('../img/p.png');content:'read';--remote:url(/api/a);background-image:image-set('/api/b' 1x)}`,
      async (value: string) => value.startsWith('../') ? 'blob:safe' : null);
    expect(result).toContain('blob:safe');
    expect(result).toContain('calc(1em + 2px)');
    expect(result).toContain('color:red');
    expect(result).not.toMatch(/@import|\/api\/|image-set|--remote/);
  });
  it.each([
    String.raw`p{background:u\72l(/api/a)}`, String.raw`@\69mport '/api/b';`,
    `p{background:var(--network);width:expression(fetch('/api/c'))}`, `@document url('/api/d'){p{color:red}}`,
    `p{background:URL(https://evil.test/a);cursor:url(/api/e),auto}`,
  ])('blocks escaped/unknown CSS and remote fetches: %s', async css => {
    expect(await sanitizeCss(css, async () => null)).not.toMatch(/\/api\/|evil\.test|expression|var\(/);
  });
});
