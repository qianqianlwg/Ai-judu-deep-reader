# 句读 · Judu Reader

面向经典原著和高密度文本的 AI 深度阅读器。

## 当前阶段

第一阶段桌面 Web 端已包含：

- EPUB、文字型 PDF、TXT/Markdown 导入接口；
- 书籍按章节和段落解析；
- 桌面三栏阅读器；
- 选中文本后调用句读；
- 前后文拼接；
- 结构化句读结果面板；
- OpenAI-compatible API 适配；
- 未配置模型时的演示回退结果。

## 本地运行

```bash
npm install
npm run dev
```

打开 http://localhost:3000。

## 配置真实 AI

复制 `.env.example` 为 `.env.local`，填入兼容 OpenAI Chat Completions 的服务地址和密钥：

```env
AI_BASE_URL=https://your-provider.example/v1
AI_API_KEY=your-api-key
AI_MODEL=your-model
```

如果未配置，句读接口会返回演示结果，方便先调试阅读器交互。

## 重要边界

当前导入接口会解析文本并返回给前端，尚未接入持久化数据库和对象存储；第一阶段先用于本地验证核心阅读闭环。个人笔记、问题箱、书签、划线、批注不在当前阶段。
