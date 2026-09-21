# foliate-js 来源、补丁及当前集成状态

## 当前状态（2026-09-16）

按用户要求撤销仅为内置浏览器验证而引入的兼容方案：
- 章节恢复上游原生 blob URL / iframe.src 加载。
- view、paginator、fixed-layout 恢复上游 closed shadow root。
- 删除 srcdoc 运输、HTML 重新序列化及相应适配选项、测试与专用验收页。
- 不再因为工具环境异常修改产品方案；疑似环境问题先停止并请用户确认。

本次真实 EPUB 在 3283 导入成功，但内置浏览器原版加载仍超时。当前原生渲染尚未验收通过，不能引用撤销前的 srcdoc 浏览器结果作为本版本通过证据。

## 第三方来源

- 官方 foliate-js，固定 commit：`78914aef4466eb960965702401634c2cb348e9b1`，MIT。
- 随附 zip.js 2.8.22，BSD-3-Clause；CSS Tree 3.2.1，MIT。
- 许可证保留于 `public/vendor/foliate/` 与其 vendor 子目录。
- 不包含 ReadAny 业务代码，不使用 CDN，不在产品运行时下载依赖。
- `PROVENANCE.json` 记录上游与分发文件哈希；`scripts/vendor-foliate.mjs` 从固定 git 对象复现补丁。

## 保留的补丁与安全边界

- iframe sandbox 为 `allow-same-origin`，不允许脚本。
- 禁用上游直接从 URL/ZIP/其他格式创建未净化书籍的绕过入口。
- 保留 React 生命周期需要的未完成加载/关闭守卫和 relocate 章节 index。
- 固定版式 getContents 的章节 index 与受信 setStyles 接口在 bridge 中统一；不修改全局 prototype。
- ZIP 结构与实际解压限制、XHTML/SVG/CSS 净化、包内资源改写、首部 CSP 保留。
- 服务端导入先做有界解压校验，再进入旧文本 parser；浏览器检查不能代替服务端检查。

## 使用接口

```ts
const book = await loadEpub(originalBlob);
const view = await createFoliateView();
await view.open(book);
await view.init({ showTextStart: true });
// 关闭时
view.close(); view.remove(); book.destroy?.();
```

section.id 是包内 href。原版 DOM 与精读 canonical 段落通过明确映射关联，不能用模糊文字搜索代替版本/偏移校验。

## 验证与限制

- 本次撤销后定向 33 项回归、严格类型检查通过。
- 用户真实 EPUB 文本提取回归 1 项通过；这不证明原版渲染、图片/字体保真度或定位全部正确。
- 服务端原件持久化与安全修复未撤销。
- 目前严格 UTF-8/XML；ZIP64、DRM/字体混淆、部分 CSS 与原书网络资源仍有明确限制。
- `browser-smoke.mjs` 是保留的离线开发验收脚本，不是产品代码；本次没有通过它绕过用户要求的环境确认。
- 以 `reader-followup.md` 记录的当前验证状态为准，后续升级仍需重新复现和回归安全补丁。

## 2026-09-18 FB2 适配补充

- FB2共享结构模型实现位于本项目src/lib/fb2-*，固定XML解析依赖fast-xml-parser 5.11.1（MIT）；没有复制ReadAny业务代码或打开上游raw makeBook入口。
- 使用相同FoliateBook/paginator/CFI接口、原生blob章节与现有sandbox。没有因为内置浏览器环境问题增加替代运输。
- 应用自有bridge.createView对非空文字Range先做完全同文的Text端点规范化，修复真实固定版getCFI在元素端点时的空选区往返。原Range、书内节点和固定上游源码不变，纯图片/折叠范围保留原行为；真实模块测试覆盖这一区别。
- destroy/unload仅释放本书拥有的URL且幂等，跨文件原件身份与来源匹配继续严格校验。
- 固定上游14文件PROVENANCE校验通过；FB2真实浏览器视觉效果仍待环境确认，不把jsdom专项等同实机。

## 2026-09-21 生命周期修复补充

- paginator 原生章节加载补齐目标文档校验、事件异常上抛、error/同步导航失败清理、destroy 取消等待；未就绪和已关闭状态禁止 ResizeObserver 排版。
- view.goTo 不再吞掉 renderer 错误，首章初始化失败可以传回应用显示可恢复提示。
- 以上补丁由 vendor-foliate.mjs 从相同固定提交复现，并更新 PROVENANCE；iframe.src、sandbox 与 closed shadow root 不变。
- 同级于应用加载器的 foliate-paginator.test.ts / foliate-view.test.ts 覆盖实际分发代码。前者在测试 VM 暴露内部 View 并模拟 iframe 事件，仅证明控制流，不证明浏览器加载成功。
- 最新原版浏览器验收仍未完成；参见 reader-followup.md 的 2026-09-21 记录，不能使用此前撤销的 srcdoc 结果作验收证据。
