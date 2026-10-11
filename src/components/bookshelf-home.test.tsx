// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BookshelfHome } from "./bookshelf-home";
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a> }));
const fetcher = vi.fn<typeof fetch>();
const edition = { id: "old", fileName: "哲学.epub", fileType: ".epub", createdAt: "2026-10-01" };
const book = { id: "a", title: "哲学", author: "作者", editions: [edition] };
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); localStorage.clear(); vi.spyOn(console, "error").mockImplementation(() => undefined);
  fetcher.mockImplementation(async input => { const url = String(input); if (url === '/api/library') return Response.json([book]); throw new Error('不应请求：' + url); });
  vi.stubGlobal('fetch', fetcher); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(<BookshelfHome />));
async function click(selector: string) { const node = host.querySelector<HTMLElement>(selector); if (!node) throw new Error('缺少节点：' + selector); await act(async () => node.click()); }
async function upload(size = 1) { const input = host.querySelector<HTMLInputElement>('#book-file')!; const file = new File(['正文'], '测试.txt'); Object.defineProperty(file, 'size', { value: size }); Object.defineProperty(input, 'files', { configurable: true, value: [file] }); await act(async () => input.dispatchEvent(new Event('change', { bubbles: true }))); }
it("外层首页仅展示全部书籍和全局设置，不自动加载最近书籍的工作台或会话", async () => {
  localStorage.setItem('judu:active-book', 'a'); localStorage.setItem('judu:edition:a', 'old'); await render();
  expect(host.querySelector('.bookshelf-home')).not.toBeNull(); expect(host.textContent).toContain('哲学');
  expect(host.querySelector('.workspace-nav, .analysis-panel, .reading-pane')).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(host.querySelector('a[href="/settings"]')).not.toBeNull(); expect(navigation.push).not.toHaveBeenCalled();
  await click('.bookshelf-open'); expect(navigation.push).toHaveBeenCalledWith('/?bookId=a&editionId=old');
});
it("导入先确认索引授权，默认导入成功仍留在书架等待选书", async () => {
  await render(); const input = host.querySelector<HTMLInputElement>('#book-file')!; const picker = vi.spyOn(input, 'click');
  await click('.bookshelf-import'); expect(picker).not.toHaveBeenCalled(); expect(host.querySelector('.import-book-dialog')).not.toBeNull();
  await click('.import-book-primary'); expect(picker).toHaveBeenCalledOnce();
  const imported = { id: 'b', title: '新书', author: '作者', editionId: 'new', chapters: [] };
  fetcher.mockResolvedValueOnce(Response.json(imported)).mockResolvedValueOnce(Response.json([book, { ...imported, editions: [] }])); await upload();
  expect(host.textContent).toContain('新书'); expect(host.textContent).toContain('请在书架选择它'); expect(navigation.push).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.some(([url]) => String(url).startsWith('/api/books/') || String(url).startsWith('/api/search/index'))).toBe(false);
  expect(fetcher.mock.calls[1][1]?.headers).toEqual({ 'X-Judu-Import-Response': 'compact' });
});
it("导入失败有明确反馈、保留书库并允许重试", async () => {
  await render(); fetcher.mockResolvedValueOnce(Response.json({ error: '书籍格式无效' }, { status: 422 })); await upload();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('格式无效'); expect(host.textContent).toContain('哲学'); expect(console.error).toHaveBeenCalled(); expect(host.querySelector<HTMLButtonElement>('.bookshelf-import')?.disabled).toBe(false);
});
it("超大文件在发送请求前拒绝，异常导入响应不伪造成功", async () => {
  await render(); await upload(300 * 1024 * 1024 + 1); expect(fetcher).toHaveBeenCalledTimes(1); expect(host.querySelector('[role="alert"]')?.textContent).toContain('300 MB');
  fetcher.mockResolvedValueOnce(Response.json({ id: 'b' })); await upload(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('不匹配'); expect(navigation.push).not.toHaveBeenCalled();
});
