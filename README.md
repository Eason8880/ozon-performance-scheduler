# Ozon Performance 按订单付款推广定时开关

Next.js 控制台用于给 Ozon Performance 店铺设置每日统一开启/关闭「按订单付款 — 全部商品」推广的时间。支持 `Europe/Moscow` 和 `Asia/Shanghai`、跨午夜时段、暂停/恢复与失败重试。

## 当前实现和边界

- Performance API 使用 `POST /api/client/token` 换取 Bearer token，再调用全商品开关端点：
  - `GET /api/client/campaign/all_sku_promo/activate`
  - `GET /api/client/campaign/all_sku_promo/deactivate`
- Ozon 的[Performance API 文档](https://docs.ozon.ru/api/performance/zh/?__rr=2#operation/ActivateAllSkuPromoCampaign)在本次实现时无法从开发环境直接访问。端点路径和响应结构参照[公开 OpenAPI 镜像](https://github.com/MissiaL/ozon-api/blob/main/references/ozon-performance-openapi.json)；token `client_credentials` 示例参照[公开文档镜像](https://github.com/DragonSigh/ozon-performance-api-docs/blob/master/%D0%BA%D0%B0%D0%BA-%D0%BF%D0%BE%D0%BB%D1%83%D1%87%D0%B8%D1%82%D1%8C-api-%D0%BA%D0%BB%D1%8E%D1%87.md)。Ozon 在[官方公告](https://dev.ozon.ru/news/691-Performance-API-Optimizatsiia-kontrolia-dostupov-cherez-OAuth/)说明自 2026-04 起增加 OAuth 授权控制。本代码采用 Performance service account 的 client ID/secret 流程；未用真实店铺凭据完成 API 联调。
- 操作端点是 GET 且有副作用，代码设置 `cache: no-store`。调用超时设为 10 秒；失败会按 HTTP 状态码记录，不保存或返回 Ozon 原始响应。
- PostgreSQL 保存店铺配置、最近成功动作键和运行日志。每店采用事务级 advisory try-lock；同一动作成功后不会重复执行，失败后下一轮重试。凭据用 AES-256-GCM 加密。
- 首次添加/修改计划后，下一次调度会把广告状态同步到当前时段应有的状态。启用按钮只控制自动计划，不会立即关闭广告；删除店铺只删除本工具内的凭据和计划。
- 时段采用左闭右开规则：开始时刻起开启，到结束时刻关闭。开始晚于结束即跨午夜；两个时间不能相同。
- 仓库自带 GitHub Actions 调度器，每 5 分钟触发一次，实际执行可能受 GitHub 排队影响而更晚。因此 UI 设分钟时间，但自动开关通常有最多约 5 分钟调度粒度误差，不能保证精确到分钟。GitHub Actions 定时任务的最小间隔为 5 分钟。可改用 Vercel Pro Cron 每分钟请求 `/api/cron`；Vercel Hobby 的 Cron 频率限制不支持每分钟。当前无法从此 Vercel CLI 查询账号套餐，所以部署配置不启用 Vercel Cron。
- 尚未进行真实 Ozon 广告开关调用。全商品开关影响该店铺在对应推广类型下的全部商品，请在添加真实凭据前确认此影响范围。

## 本地运行

Node.js 20+ 和 PostgreSQL。首次数据库访问时自动建表。

```bash
npm install
cp .env.example .env.local
# 设置以下环境变量，再启动
npm run dev
```

必填变量：

- `DATABASE_URL`：PostgreSQL 连接 URI（需可从 Vercel Serverless Function 连接）。可在 Vercel Marketplace 为项目添加 Prisma Postgres 的 **Free** 计划，或使用其他 PostgreSQL。
- `APP_SECRET`：base64 编码的 32 字节 AES key；可用 `openssl rand -base64 32` 生成。
- `SESSION_SECRET`：至少 32 字符的随机 session 签名密钥。
- `ADMIN_PASSWORD`：管理员登录密码。
- `CRON_SECRET`：随机调度 bearer secret。不要复用上述密钥。

`DATABASE_SSL` 默认开启 TLS 校验宽松模式以兼容托管数据库；本地无 TLS PostgreSQL 可设 `disable`。

## Vercel 部署与 GitHub 自动部署

1. 创建公开 GitHub 仓库并将 `main` 导入 Vercel；在 Vercel 项目中选择 Node 24 或 20。连接 GitHub 后，合并 PR 到 `main` 会触发生产部署。
2. Vercel Marketplace 为项目创建并连接 Prisma Postgres Free，确保生成的 `DATABASE_URL` 覆盖 Production、Preview、Development。数据库服务商的免费额度和条款以创建时页面为准。
3. 在 Vercel 项目设置中为 Production 和 Preview 分别设置随机且独立的 `APP_SECRET`、`SESSION_SECRET`、`ADMIN_PASSWORD`、`CRON_SECRET`。不要把 `.env.local` 提交到仓库。可用 `openssl rand -base64 32` 生成 AES key、`openssl rand -hex 32` 生成其余随机值。
4. 在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加 `SCHEDULER_URL`（Vercel 项目域名，不带尾斜杠）与 `CRON_SECRET`。Production 的 `CRON_SECRET` 必须与 Vercel Production 环境一致。GitHub Actions workflow 即会每 5 分钟触发 `/api/cron`。
5. 部署完成后登录并用真实 Performance Client ID/Client Secret 添加店铺。添加动作会先向 Ozon 申请 token 以验证凭据。

数据库初始化在应用访问时自动运行。Preview/Production 环境应连接不同数据库或至少使用独立 schema/实例，避免预览部署操作生产店铺。
