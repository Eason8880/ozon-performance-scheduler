# Ozon Performance 按订单付款推广定时开关

Next.js 控制台用于给 Ozon Performance 店铺设置每日统一开启/关闭「按订单付款 — 全部商品」推广的时间。支持 `Europe/Moscow` 和 `Asia/Shanghai`、多时段组合、跨午夜、暂停/恢复与失败重试。

## 当前实现和边界

- Performance API 使用 `POST /api/client/token` 换取 Bearer token，再调用全商品开关端点：
  - `GET /api/client/campaign/all_sku_promo/activate`
  - `GET /api/client/campaign/all_sku_promo/deactivate`
- Ozon 的[Performance API 文档](https://docs.ozon.ru/api/performance/zh/?__rr=2#operation/ActivateAllSkuPromoCampaign)在本次实现时无法从开发环境直接访问。端点路径和响应结构参照[公开 OpenAPI 镜像](https://github.com/MissiaL/ozon-api/blob/main/references/ozon-performance-openapi.json)；token `client_credentials` 示例参照[公开文档镜像](https://github.com/DragonSigh/ozon-performance-api-docs/blob/master/%D0%BA%D0%B0%D0%BA-%D0%BF%D0%BE%D0%BB%D1%83%D1%87%D0%B8%D1%82%D1%8C-api-%D0%BA%D0%BB%D1%8E%D1%87.md)。Ozon 在[官方公告](https://dev.ozon.ru/news/691-Performance-API-Optimizatsiia-kontrolia-dostupov-cherez-OAuth/)说明自 2026-04 起增加 OAuth 授权控制。本代码采用 Performance service account 的 client ID/secret 流程；未用真实店铺凭据完成 API 联调。
- 操作端点是 GET 且有副作用，代码设置 `cache: no-store`。调用超时设为 10 秒；失败会按 HTTP 状态码记录，不保存或返回 Ozon 原始响应。
- PostgreSQL 保存店铺配置、最近成功动作键和运行日志。每店采用事务级 advisory try-lock；同一动作成功后不会重复执行，失败后下一轮重试。凭据用 AES-256-GCM 加密。
- 首次添加/修改计划后，下一次调度会把广告状态同步到当前时段应有的状态。启用按钮只控制自动计划，不会立即关闭广告；删除店铺只删除本工具内的凭据和计划。
- 页面提供三个时段预设（莫斯科时间 19:00–23:00、09:00–11:00、13:00–15:00），可以组合并修改到分钟。选择店铺时区后，预设会显示对应的本地时间；在莫斯科与北京时区间切换会平移已有时段，以保持同一实际时刻。
- 时段采用左闭右开规则：开始时刻起开启，到结束时刻关闭。开始晚于结束即跨午夜；两个时间不能相同。单店最多 8 段，重叠时段拒绝保存。
- 项目所在 Vercel 团队套餐为 Pro，配置 Vercel Cron 每分钟请求一次 `/api/cron`。Vercel Cron 请求以 `CRON_SECRET` bearer token 鉴权；运行函数并发 3 个店铺，40 秒后延后的店铺留待下一轮。开关时间按店铺本地时区计算，服务器 UTC 时区不会造成时间偏移。
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

- `DATABASE_URL`：PostgreSQL 连接 URI（需可从 Vercel Serverless Function 连接）。Neon PostgreSQL 已连接到生产环境。
- `APP_SECRET`：base64 编码的 32 字节 AES key；可用 `openssl rand -base64 32` 生成。
- `SESSION_SECRET`：至少 32 字符的随机 session 签名密钥。
- `ADMIN_PASSWORD`：管理员登录密码。
- `CRON_SECRET`：随机调度 bearer secret。不要复用上述密钥。

`DATABASE_SSL` 默认遵循连接 URI 的 SSL 设置；设为 `require` 时启用证书校验，只有本地无 TLS PostgreSQL 才设为 `disable`。

## Vercel 部署与 GitHub 自动部署

1. 创建公开 GitHub 仓库并将 `main` 导入 Vercel；在 Vercel 项目中选择 Node 24 或 20。连接 GitHub 后，合并 PR 到 `main` 会触发生产部署。
2. Vercel Marketplace 已连接 Neon PostgreSQL，仅绑定 Production。数据库服务商的免费额度和条款以创建时页面为准。Preview 不绑定生产数据库或生产密钥；如果要让 Preview 可登录/执行，应另建独立免费数据库并设置 Preview 专用密钥。
3. 在 Vercel Production 环境设置独立随机的 `APP_SECRET`、`SESSION_SECRET`、`ADMIN_PASSWORD`、`CRON_SECRET`。Preview 不配置生产密钥或生产数据库。不要把 `.env.local` 提交到仓库。可用 `openssl rand -base64 32` 生成 AES key、`openssl rand -hex 32` 生成其余随机值。
4. Vercel Production 已配置 `CRON_SECRET`，Cron 自动调用 `/api/cron`。Preview 不连接生产数据库，也不自动执行店铺计划。
5. 部署完成后登录并用真实 Performance Client ID/Client Secret 添加店铺。添加动作会先向 Ozon 申请 token 以验证凭据。

数据库初始化在应用访问时自动运行。Preview/Production 环境应连接不同数据库或至少使用独立 schema/实例，避免预览部署操作生产店铺。
