# 当前服务器部署

- 项目目录：`/home/admin/Ai-judu-deep-reader`
- 正式入口：`https://lwg-aiserve.abrdns.com/`
- 进程：`judu-reader.service`，用户 `admin`，监听 `127.0.0.1:3000`，开机启动、失败自动重启。
- Node：`/home/admin/.nvm/versions/node/v24.22.1/bin/node`。
- 数据：项目默认 `data` 目录，不提交 Git。首次部署为空书库。
- Caddy 保留 `/etc/caddy/judu-access.caddy` 的既有认证；配置备份为 `/etc/caddy/Caddyfile.before-judu`。
- 应用配置 `JUDU_APP_ORIGIN=https://lwg-aiserve.abrdns.com`；模型密钥需在应用设置中配置。

## 运维

```sh
sudo systemctl status judu-reader
sudo journalctl -u judu-reader -n 100 --no-pager
sudo systemctl restart judu-reader
```

使用 Node 24.22.1 执行 `npm ci`、`npm run build -- --webpack` 后重启服务。构建时使用 `NODE_OPTIONS=--max-old-space-size=1024`；默认 Turbopack 在本机未能完成。服务器新增 2GB `/swapfile-judu`，已配置 fstab 和 swappiness=60。

备份时需同时保留整个 `data` 目录及服务配置；SQLite 在线备份使用 SQLite backup API，或停服务后复制，避免遗漏 WAL 数据。不要在运行中的构建目录上重新构建，更新应先在独立目录验证。

## 验证与限制

- 生产 Webpack 构建通过，包含 TypeScript 检查。
- 哈希、标注、工作台导航、书库及来源保护 58 项测试通过。
- 主题、导入和转换 47 项测试通过；小内存服务器上导入用例需要 30 秒超时，原 5 秒超时在并行构建时失败。
- 3101 独立数据目录验证完成，临时服务已停止；正式 3000 首页及书库 API 正常。
- 公网 HTTPS 未登录返回 401，HTTP 返回 308；未掌握原认证密码，因此没有验证公网登录后的页面和模型调用。
- 上游依赖审计仍有高危和严重漏洞（包括 Next.js）；本次保留锁定版本以完成兼容部署，访问仅限现有认证用户，后续需单独升级与回归。
