import { describe, expect, it, vi } from 'vitest';
import { sanitizeCss } from '../../public/vendor/foliate/security-css.js';
import { generate, parse } from '../../public/vendor/foliate/vendor/csstree.esm.js';
import { sanitizeMobiCss, type MobiCssResolver } from './mobi-css-sanitizer.mjs';

const token = (file: string) => `mobi-resource-v1/${file}`;
const canonical = (css: string) => generate(parse(css));
const deny = vi.fn(async () => null);
function resolver(values: Record<string, string | null> = {}) {
  return vi.fn(async (value: string, role: 'style' | 'css') => values[`${role}:${value}`] ?? null);
}

describe('MOBI CSS 固定净化器包装层', () => {
  it('保留 string/url import、layer/supports/media 条件和普通 url 的角色', async () => {
    const source = `@import "book.css" layer(book.theme) supports(display:grid) screen and (min-width:20em);
      @import url(print.css) layer supports((display:grid) and (not (color:red))) print;
      p{color:red;background:url(img.png)}`;
    const resolve = resolver({ 'style:book.css': token('book.css'), 'style:print.css': token('print.css'),
      'css:img.png': token('img.png') });
    expect(await sanitizeMobiCss(source, resolve)).toBe(canonical(source
      .replace('"book.css"', `"${token('book.css')}"`).replace('url(print.css)', `url(${token('print.css')})`)
      .replace('url(img.png)', `url(${token('img.png')})`)));
    expect(resolve.mock.calls).toEqual([['book.css', 'style'], ['print.css', 'style'], ['img.png', 'css']]);
  });

  it.each([
    'layer', 'layer(book.chapter)', 'supports(display:grid)',
    'supports((display:grid) or (display:flex))', 'supports(not (display:grid))',
    'supports(selector(:is(a,b))) only screen',
    'screen and (width:calc(20em + 1px)), print',
    'layer(theme) supports(display:grid) screen and (400px < width < 800px)',
  ])('原样保留结构化条件：%s', async condition => {
    const resolve = resolver({ 'style:a.css': token('a.css') });
    expect(await sanitizeMobiCss(`@import "a.css" ${condition};`, resolve))
      .toBe(canonical(`@import "${token('a.css')}" ${condition};`));
  });

  it('不提升 import、不改变 layer 顺序、不去重同一资源', async () => {
    const source = `@charset "UTF-8"; @layer reset,theme;
      @import "a.css" layer(reset); @layer print;
      @import "a.css" layer(theme) screen; @import "b.css" print;
      @layer theme {p{color:blue}} p{color:red}`;
    const resolve = resolver({ 'style:a.css': token('a.css'), 'style:b.css': token('b.css') });
    const expected = source.replace('@charset "UTF-8";', '').replaceAll('"a.css"', `"${token('a.css')}"`)
      .replace('"b.css"', `"${token('b.css')}"`);
    expect(await sanitizeMobiCss(source, resolve)).toBe(canonical(expected));
    expect(resolve.mock.calls).toEqual([['a.css', 'style'], ['a.css', 'style'], ['b.css', 'style']]);
  });

  it('注释、大小写不会影响合法 import 的位置；null 仅移除该导入', async () => {
    const resolve = resolver({ 'style:b.css': token('b.css') });
    expect(await sanitizeMobiCss('/*before*/ @IMPORT "missing.css"; @LaYeR a; @IMPORT "b.css"; p{color:red}', resolve))
      .toBe(canonical(`@LaYeR a; @IMPORT "${token('b.css')}"; p{color:red}`));
  });

  it.each([
    'https://evil.test/a.css', '//evil.test/a.css', '/api/private', 'data:text/css,p{}',
    'javascript:alert(1)', 'blob:untrusted', 'file:///tmp/a.css', 'C:/secret.css',
    'hTtPs:evil.test/a.css', 'https%3A%2F%2Fevil.test/a.css', '%2F%2Fevil.test/a.css',
    '%2568ttps%253Aevil.test', '%0Ajavascript:alert(1)', 'bad%ZZ.css',
  ])('外部/编码混淆地址既不泄漏也不交给 resolver：%s', async value => {
    const resolve = vi.fn(async () => token('unsafe.css'));
    const css = `@import "${value}" screen; p{background:url("${value}");color:red}`;
    expect(await sanitizeMobiCss(css, resolve)).toBe('p{color:red}');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('string 形式 import 改写为 token，不能泄漏原始路径', async () => {
    const resolve = resolver({ 'style:../styles/private.css': token('hashed.css') });
    const result = await sanitizeMobiCss('@import "../styles/private.css";', resolve);
    expect(result).toBe(canonical(`@import "${token('hashed.css')}";`));
    expect(result).not.toContain('../styles/private.css');
  });

  it('仅保留 resolver 确认的片段/token，普通 url 一律使用 css 角色', async () => {
    const resolve = resolver({ 'style:a.css': token('a.css') + '#part', 'css:#filter': '#filter',
      'css:font.woff2': token('font.woff2'), 'style:#local': '#local' });
    const source = '@import "a.css"; @import "#local"; @font-face{src:url(font.woff2)} p{filter:url(#filter)}';
    expect(await sanitizeMobiCss(source, resolve)).toBe(canonical(
      `@import "${token('a.css')}#part"; @import "#local"; @font-face{src:url(${token('font.woff2')})} p{filter:url(#filter)}`));
    expect(resolve.mock.calls).toEqual([['a.css', 'style'], ['#local', 'style'], ['font.woff2', 'css'], ['#filter', 'css']]);
  });

  it.each([
    'p{color:red}@import "a.css";', '@media screen{} @import "a.css";',
    '@supports (display:grid){} @import "a.css";', '@font-face{} @import "a.css";',
    '@layer a{} @import "a.css";', '@namespace "x"; @import "a.css";',
    '@unknown; @import "a.css";', '@layer; @import "a.css";',
    '@layer a; @charset "UTF-8"; @import "a.css";',
    '@import "a.css"; p{color:red} @import "b.css";',
  ])('按原始位置拒绝晚到导入，不能因规则被净化删除而激活：%s', async source => {
    const resolve = resolver();
    await expect(sanitizeMobiCss(source, resolve)).rejects.toThrow(/@import position/);
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    '@media screen{@import "a.css";}', '@supports (display:grid){@import "a.css";}',
    '@layer theme{@import "a.css";}', 'p{@import "a.css";color:red}',
  ])('拒绝嵌套导入：%s', async source => {
    const resolve = resolver();
    await expect(sanitizeMobiCss(source, resolve)).rejects.toThrow(/inline\/nested/);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('inline 不接受 import，但保持普通声明的上游净化行为', async () => {
    await expect(sanitizeMobiCss('@import "a.css"; color:red', deny, true)).rejects.toThrow(/inline\/nested/);
    const source = 'color:red;background:url(img.png);margin:calc(1em + 2px);content:"@import url(data:x)"';
    const resolve = resolver({ 'css:img.png': token('img.png') });
    expect(await sanitizeMobiCss(source, resolve, true))
      .toBe(await sanitizeCss(source, async () => token('img.png'), true));
    expect(resolve.mock.calls).toEqual([['img.png', 'css']]);
  });

  it.each([
    '@import "a.css" {}', '@import;', '@import "a.css" layer();', '@import "a.css" supports();',
    '@import "a.css" layer(foo..bar);', '@import "a.css" wat(foo);',
    '@import "a.css" layer(foo) layer(bar);', '@import "a.css" supports(display:grid) layer(foo);',
    '@import "a.css" supports(whatever(foo));', '@import "a.css" screen and (whatever(foo));',
    '@import "a.css" supports(background:url(https://evil.test/x));',
    '@import "a.css" supports(background:url(img.png));',
    '@import "a.css" supports(background:image-set("hidden.png" 1x));',
    '@import "a.css" supports(color:var(--x));', '@import "a.css" screen and (x:funky(1));',
  ])('拒绝未知/恢复 Raw 或不安全条件，不降级成无条件导入：%s', async source => {
    const resolve = resolver();
    await expect(sanitizeMobiCss(source, resolve)).rejects.toThrow(/MOBI CSS:/);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('保留 content 与 supports/selector 中惰性字面字符串，不把它们当资源', async () => {
    const source = `@import "a.css" supports(content:'"url(https://text.test/x)"');
      p::before{content:'@import "https://text.test/private.css"; url(data:literal) javascript:literal'}`;
    const resolve = resolver({ 'style:a.css': token('a.css') });
    expect(await sanitizeMobiCss(source, resolve)).toBe(canonical(source.replace('"a.css"', `"${token('a.css')}"`)));
    expect(resolve.mock.calls).toEqual([['a.css', 'style']]);
  });

  it('普通规则仍由固定 sanitizer 决定，不另写属性/函数白名单', async () => {
    const source = `@font-face{font-family:Book;src:url(font.woff2) format("woff2")}
      @media screen and (min-width:20em){p{color:red;margin:calc(1em + 2px)}}
      @supports (display:grid){.grid{display:grid}}
      @layer book{p{background:linear-gradient(red,blue)}}
      @keyframes fade{from{opacity:0}to{opacity:1}}
      p{background:url(img.png);width:expression(evil());background-image:image-set("hidden" 1x);
      --remote:url(hidden.png);color:var(--color);behavior:url(hidden.png);content:'read'}`;
    const resolve = resolver({ 'css:font.woff2': token('font.woff2'), 'css:img.png': token('img.png') });
    const expected = await sanitizeCss(source, async (value: string) => token(value));
    expect(await sanitizeMobiCss(source, resolve)).toBe(expected);
    expect(resolve.mock.calls).toEqual([['font.woff2', 'css'], ['img.png', 'css']]);
    const withImport = await sanitizeMobiCss('@import "a.css";'+source,
      resolver({ 'style:a.css': token('a.css'), 'css:font.woff2': token('font.woff2'), 'css:img.png': token('img.png') }));
    expect(withImport).toBe(canonical(`@import "${token('a.css')}";`) + expected);
  });

  it.each(['style', 'css'] as const)('resolver 的 %s 异常原样上抛', async role => {
    const cause = new Error('graph cycle/depth/MIME rejection');
    const resolve: MobiCssResolver = async () => { throw cause; };
    const source = role === 'style' ? '@import "a.css";' : 'p{background:url(a.png)}';
    await expect(sanitizeMobiCss(source, resolve)).rejects.toBe(cause);
  });

  it.each([
    'https://evil.test/a', '//evil.test/a', '/api/private', 'data:text/css,x', 'javascript:alert(1)',
    'blob:untrusted', 'a.css', 'mobi-resource-v1/../a.css', 'mobi-resource-v1/%2e%2e/a.css',
    'mobi-resource-v1/a.css?x=1', 'mobi-resource-v1/a.css\n', 'mobi-resource-v1/a.css#bad%0A',
    'mobi-resource-v1/a.css#bad%ZZ', '#', '#bad%5C', '', undefined, false, 42, {}, ['mobi-resource-v1/a.css'],
  ])('畸形 resolver 结果失败关闭，不泄漏或隐式转换：%j', async result => {
    const resolve = (async () => result) as unknown as MobiCssResolver;
    for (const source of ['@import "a.css";', 'p{background:url(a.png)}']) {
      await expect(sanitizeMobiCss(source, resolve)).rejects.toThrow(/invalid resolver result/);
    }
  });

  it('null 普通 URL 删除整条声明，仍保留其他安全声明', async () => {
    expect(await sanitizeMobiCss('p{background:url(missing.png);color:red}', deny)).toBe('p{color:red}');
  });

  it.each([String.raw`@\69mport "a.css";`, String.raw`p{background:u\72l(a.png)}`, 'p{color:red}\u0000'])
    ('不放宽上游转义/控制字符策略：%s', async source => {
      await expect(sanitizeMobiCss(source, deny)).rejects.toThrow(/escapes\/control/);
    });

  it('空输入、输入预算及不可信 JS 调用参数', async () => {
    expect(await sanitizeMobiCss('', deny)).toBe('');
    await expect(sanitizeMobiCss(' '.repeat(2 * 1024 * 1024 + 1), deny)).rejects.toThrow(/input exceeds/);
    await expect(sanitizeMobiCss(null as unknown as string, deny)).rejects.toThrow(/invalid arguments/);
    await expect(sanitizeMobiCss('', null as unknown as MobiCssResolver)).rejects.toThrow(/invalid arguments/);
    await expect(sanitizeMobiCss('', deny, 'yes' as unknown as boolean)).rejects.toThrow(/invalid arguments/);
  });
});

describe('引号哨兵修复的定向安全回归', () => {
  it('恢复只产生原有惰性字符串，碰撞文本与URL/import不被替换，重复净化稳定', async () => {
    const payload = '";background:url(https://evil.test/leak);@import "https://evil.test/evil.css";content:"';
    const source = `@import "judu-safe-literal-0.css" layer(book) screen;
      p{content:${JSON.stringify(payload)};quotes:${JSON.stringify('"')} ${JSON.stringify("'")};
      font-family:${JSON.stringify('Book "Q"')};background:url(judu-safe-literal-0.png)}
      q{content:"judu-safe-literal-0";font-family:"judu-safe-literal-x0"}`;
    const resolve = vi.fn(async (value: string) => value.startsWith('mobi-resource-v1/') ? value : token(value));
    const expected = canonical(source.replace('@import "judu-safe-literal-0.css"', `@import "${token('judu-safe-literal-0.css')}"`)
      .replace('url(judu-safe-literal-0.png)', `url(${token('judu-safe-literal-0.png')})`));
    // WHY：完整 AST 序列化结果必须等价；引号中的 URL/分号/import 不得成为活动语法或 resolver 请求。
    const once = await sanitizeMobiCss(source, resolve);
    expect(once).toBe(expected);
    expect(await sanitizeMobiCss(once, resolve)).toBe(expected);
    expect(resolve.mock.calls).toEqual([
      ['judu-safe-literal-0.css', 'style'], ['judu-safe-literal-0.png', 'css'],
      [token('judu-safe-literal-0.css'), 'style'], [token('judu-safe-literal-0.png'), 'css'],
    ]);
  });

  it('合法直接String不能为URL、函数、import、标识符或控制字符转义开旁路', async () => {
    const safe = String.raw`content:"safe \"quote\"";`;
    const cases = [
      `p{${safe}${String.raw`background:url("a\".png")`}}`,
      `p{${safe}${String.raw`content:counter("name\"suffix")`}}`,
      `p{${safe}${String.raw`font-family:local("Book \"Q\"")`}}`,
      `${String.raw`@import "a\".css";`}p{${safe}}`,
      `p{${safe}${String.raw`background:u\72l(a.png)`}}`,
      String.raw`p{content:"hex \22 quote"}`,
      `p{${safe}}\u0000`,
    ];
    for (const source of cases) {
      const resolve = vi.fn(async (value: string) => token(value));
      await expect(sanitizeMobiCss(source, resolve), source).rejects.toThrow(/escapes\/control/u);
      expect(resolve).not.toHaveBeenCalled();
    }
  });

  it('哨兵路径仍将整个CSS交给原净化器，危险函数/声明被移除而合法import条件保留', async () => {
    const literal = JSON.stringify('safe "quote"');
    const source = `@import "a.css" layer(book) supports(display:grid) print;
      p{content:${literal};width:expression(evil());behavior:url(hidden.png);
      background-image:image-set("hidden.png" 1x);background:url(visible.png);color:red}`;
    const resolve = resolver({ 'style:a.css': token('a.css'), 'css:visible.png': token('visible.png') });
    const output = await sanitizeMobiCss(source, resolve);
    expect(output).toBe(canonical(`@import "${token('a.css')}" layer(book) supports(display:grid) print;
      p{content:${literal};background:url(${token('visible.png')});color:red}`));
    expect(resolve.mock.calls).toEqual([['a.css', 'style'], ['visible.png', 'css']]);
    expect(output).not.toMatch(/expression|behavior|image-set|hidden\.png/u);
  });
});
