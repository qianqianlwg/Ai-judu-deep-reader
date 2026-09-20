import { once } from 'node:events';
import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { generate, parse } from '../../public/vendor/foliate/vendor/csstree.esm.js';
import { rewriteMobiCssUrls, type MobiCssUrlResolver } from './mobi-css-urls.mjs';

const token = (file: string) => `mobi-resource-v1/${file}`;
const blob = (file: string) => `blob:https://reader.invalid/${file}`;
const canonical = (source: string, inline = false) => generate(parse(source, { context: inline ? 'declarationList' : 'stylesheet' }));
const resolve = (value: string) => Promise.resolve(blob(value.slice('mobi-resource-v1/'.length)));

describe('MOBI已净化CSS的AST URL运输', () => {
  it('同时改写 String/Url import 与声明 Url，保留完整 layer/supports/media 次序', async () => {
    const source = `@layer reset,theme;
      @import "${token('book.css')}" layer(theme) supports(display:grid) screen and (min-width:20em);
      @import url(${token('print.css')}) layer supports((display:grid) and (not (color:red))) print;
      @font-face{font-family:Book;src:url(${token('book.woff2')}) format("woff2")}
      @media screen{p{background:url(${token('cover.png')});color:red}}`;
    const resolver = vi.fn(resolve);
    expect(await rewriteMobiCssUrls(source, resolver)).toBe(canonical(source.replaceAll('mobi-resource-v1/', 'blob:https://reader.invalid/')));
    expect(resolver.mock.calls).toEqual(['book.css', 'print.css', 'book.woff2', 'cover.png'].map(file => [token(file)]));
  });

  it.each([
    'layer', 'layer(book.chapter)', 'supports(display:grid)',
    'supports((display:grid) or (display:flex))', 'supports(not (display:grid))',
    'supports(selector(:is(a,b))) only screen', 'screen and (width:calc(20em + 1px)), print',
    'layer(theme) supports(display:grid) screen and (400px < width < 800px)',
  ])('只改目标，不移动或削弱 import 条件：%s', async condition => {
    const source = `@import "${token('book.css')}" ${condition};`;
    expect(await rewriteMobiCssUrls(source, resolve)).toBe(canonical(source.replace(token('book.css'), blob('book.css'))));
  });

  it('保留重复 import、穿插 layer 声明及其原顺序，不合并相同资源', async () => {
    const source = `@layer a; @import "${token('book.css')}" layer(a);
      @layer b; @import url(${token('book.css')}) layer(b) print;
      @import "${token('next.css')}" screen; p{color:red}`;
    const resolver = vi.fn(resolve);
    expect(await rewriteMobiCssUrls(source, resolver)).toBe(canonical(source.replaceAll('mobi-resource-v1/', 'blob:https://reader.invalid/')));
    expect(resolver.mock.calls).toEqual([[token('book.css')], [token('book.css')], [token('next.css')]]);
  });

  it('不碰 content、selector、import 条件里的惰性字符串', async () => {
    const source = `@import "${token('book.css')}" supports(content:"${token('cover.png')}");
      [data-url="${token('cover.png')}"]::before{content:'url(${token('cover.png')})';background:url(${token('cover.png')})}
      p::after{content:"${token('book.css')}"}`;
    const resolver = vi.fn(resolve);
    const expected = source.replace(`@import "${token('book.css')}"`, `@import "${blob('book.css')}"`)
      .replace(`background:url(${token('cover.png')})`, `background:url(${blob('cover.png')})`);
    expect(await rewriteMobiCssUrls(source, resolver)).toBe(canonical(expected));
    expect(resolver.mock.calls).toEqual([[token('book.css')], [token('cover.png')]]);
  });

  it('content 中的真正 Url 节点改写，但同一声明的字符串不动', async () => {
    const source = `p::before{content:url(${token('cover.png')}) "${token('cover.png')}"}`;
    const expected = `p::before{content:url(${blob('cover.png')}) "${token('cover.png')}"}`;
    expect(await rewriteMobiCssUrls(source, resolve)).toBe(canonical(expected));
  });

  it('inline 使用 declarationList，无需伪造规则包装或丢弃后续声明', async () => {
    const source = `background:url('${token('cover.png')}');content:"${token('cover.png')}";color:red!important`;
    const expected = `background:url('${blob('cover.png')}');content:"${token('cover.png')}";color:red!important`;
    expect(await rewriteMobiCssUrls(source, resolve, true)).toBe(canonical(expected, true));
  });

  it('已有 blob 和本地片段不再解析；token 片段完整传递给 resolver', async () => {
    const source = `p{background:url(${blob('existing')});filter:url(#local);mask:url(${token('shape.svg')}#part%20one)}`;
    const resolver = vi.fn(async () => '#resolved');
    expect(await rewriteMobiCssUrls(source, resolver)).toBe(canonical(source.replace(`${token('shape.svg')}#part%20one`, '#resolved')));
    expect(resolver.mock.calls).toEqual([[`${token('shape.svg')}#part%20one`]]);
  });

  it('只按完整受控 token 定位，不做全文替换或初次 URL 净化', async () => {
    const source = `p{background:url(https://example.invalid/${token('cover.png')});list-style:url(other/${token('cover.png')})}`;
    const resolver = vi.fn(resolve);
    // WHY：该模块的输入已净化；这里确认它不冒充安全过滤器，非 token 的处理仍属于初次净化层。
    expect(await rewriteMobiCssUrls(source, resolver)).toBe(canonical(source));
    expect(resolver).not.toHaveBeenCalled();
  });

  it('异步 resolver 按 AST 出现顺序调用，单个 url import 不会调用两次', async () => {
    const calls: string[] = [];
    const resolver: MobiCssUrlResolver = async value => {
      calls.push(`start:${value}`); await Promise.resolve(); calls.push(`end:${value}`); return resolve(value);
    };
    await rewriteMobiCssUrls(`@IMPORT url(${token('a.css')});p{background:url(${token('b.png')})}`, resolver);
    expect(calls).toEqual([`start:${token('a.css')}`, `end:${token('a.css')}`, `start:${token('b.png')}`, `end:${token('b.png')}`]);
  });

  it('空样式表、空 inline 及无资源样式不调用 resolver', async () => {
    const resolver = vi.fn(resolve);
    expect(await rewriteMobiCssUrls('', resolver)).toBe('');
    expect(await rewriteMobiCssUrls('', resolver, true)).toBe('');
    expect(await rewriteMobiCssUrls('p{color:red}', resolver)).toBe('p{color:red}');
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe('MOBI CSS URL错误与有界运行', () => {
  it.each(['@import "TOKEN";', 'p{background:url(TOKEN)}'])('resolver 异常原样上抛：%s', async template => {
    const cause = new Error('resource graph failure');
    await expect(rewriteMobiCssUrls(template.replace('TOKEN', token('a.css')), async () => { throw cause; })).rejects.toBe(cause);
  });

  it.each([null, undefined, false, 42, {}, [], '', 'blob:', '#', 'https://evil.invalid/a', '//evil.invalid/a',
    'data:text/css,x', 'javascript:alert(1)', 'mobi-resource-v1/a.css', 'blob:bad\nurl', '#bad\\fragment']) (
    '不将非法 resolver 结果隐式转换或当作运输 URL：%j', async result => {
      const resolver = (async () => result) as unknown as MobiCssUrlResolver;
      for (const source of [`@import "${token('a.css')}";`, `p{background:url(${token('a.png')})}`]) {
        await expect(rewriteMobiCssUrls(source, resolver)).rejects.toThrow(/MOBI CSS URL: invalid resolver result/u);
      }
    },
  );

  it.each(['../a.png', '%61.png', 'a.png?x=1', 'a.png#', 'a.png#bad%ZZ', 'a.png#bad%0A', 'a.png#bad%5C']) (
    '受控前缀下的畸形 token 不可残留至发布：%s', async suffix => {
      const resolver = vi.fn(resolve);
      await expect(rewriteMobiCssUrls(`p{background:url("${token(suffix)}")}`, resolver)).rejects.toThrow(/MOBI CSS URL: invalid (?:resource token|token fragment)/u);
      expect(resolver).not.toHaveBeenCalled();
    },
  );

  it.each(['@import ;', 'p{color:red; broken}'])('解析失败或恢复 Raw 不静默输出：%s', async source => {
    await expect(rewriteMobiCssUrls(source, resolve)).rejects.toThrow(/MOBI CSS URL:/u);
  });

  it('校验 JS 边界参数', async () => {
    await expect(rewriteMobiCssUrls(null as unknown as string, resolve)).rejects.toThrow(/invalid arguments/u);
    await expect(rewriteMobiCssUrls('', null as unknown as MobiCssUrlResolver)).rejects.toThrow(/invalid arguments/u);
    await expect(rewriteMobiCssUrls('', resolve, 'yes' as unknown as boolean)).rejects.toThrow(/invalid arguments/u);
  });

  it('输入/资源数量/单个返回值/累计输出有上限', async () => {
    await expect(rewriteMobiCssUrls(' '.repeat(8 * 1024 * 1024 + 1), resolve)).rejects.toThrow(/input exceeds/u);
    await expect(rewriteMobiCssUrls(`p{${`background:url(${token('a.png')});`.repeat(20_001)}}`, resolve)).rejects.toThrow(/URL count/u);
    await expect(rewriteMobiCssUrls(`p{background:url(${token('a.png')})}`, async () => `blob:${'x'.repeat(4096)}`))
      .rejects.toThrow(/invalid resolver result/u);
    await expect(rewriteMobiCssUrls(`p{${`background:url(${token('a.png')});`.repeat(2100)}}`, async () => `blob:${'x'.repeat(4091)}`))
      .rejects.toThrow(/output exceeds/u);
  });
});

describe('CSS运输隔离端口 API 自测', () => {
  it('实际 HTTP 输出保留 import 与惰性字符串，并释放临时端口', async () => {
    const source = `@import "${token('a.css')}" layer(base) supports(display:grid) screen;p{content:"${token('a.css')}"}`;
    const server = createServer(async (_request, response) => {
      try {
        const result = await rewriteMobiCssUrls(source, resolve);
        response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' }); response.end(result);
      } catch (cause: unknown) {
        response.writeHead(500); response.end(cause instanceof Error ? cause.message : 'MOBI CSS URL: unknown test failure');
      }
    });
    try {
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('MOBI CSS URL: invalid test port');
      const response = await fetch(`http://127.0.0.1:${address.port}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(canonical(source.replace(`@import "${token('a.css')}"`, `@import "${blob('a.css')}"`)));
      console.info(`MOBI CSS URL API 验证端口：${address.port}，import/条件/惰性字符串通过`);
    } finally {
      await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
      expect(server.listening).toBe(false);
      console.info('MOBI CSS URL API 临时端口已释放；主项目未重启');
    }
  });
});
