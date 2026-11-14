# Ozon Performance 按订单付款推广定时开关

Next.js 控制台用于给 Ozon Performance 店铺设置每日统一开启/关闭「按订单付款 — 全部商品」推广的时间。支持 `Europe/Moscow` 和 `Asia/Shanghai`、多时段组合、跨午夜、暂停/恢复与失败重试。

## 当前实现和边界

- Performance API 使用 `POST /api/client/token` 换取 Bearer token，再调用全商品开关端点：
  - `GET /api/client/campaign/all_sku_promo/activate`
  - `GET /api/client/campaign/all_sku_promo/deactivate`
- Ozon 的[Performance API 文档](https://docs.ozon.ru/api/performance/zh/?__rr=2#operation/ActivateAllSkuPromoCampaign)在本次实现时无法从开发环境直接访问。端点路径和响应结构参照[公开 OpenAPI 镜像](https://github.com/MissiaL/ozon-api/blob/main/references/ozon-performance-openapi.json)；token `client_credentials` 示例参照[公开文档镜像](https://github.com/DragonSigh/ozon-performance-api-docs/blob/master/%D0%BA%D0%B0%D0%BA-%D0%BF%D0%BE%D0%BB%D1%83%D1%87%D0%B8%D1%82%D1%8C-api-%D0%BA%D0%BB%D1%8E%D1%87.md)。Ozon 在[官方公告](https://dev.ozon.ru/news/691-Performance-API-Optimizatsiia-kontrolia-dostupov-cherez-OAuth/)说明自 2026-04 起增加 OAuth 授权控制。本代码采用 Performance service account 的 client ID/secret 流程；未用真实店铺凭据完成 API 联调。
- 操作端点是 GET 且有副作用，代码设置 `cache: no-store`。调用超时设为 10 秒；失败会按 HTTP 状态码记录，不保存或返回 Ozon 原始响应。
- PostgreSQL 保存店铺配置、最近成功动作键和运行日志。每店采用会话级 advisory try-lock，加锁的操作走直连地址（`DATABASE_URL_UNPOOLED`）：Neon 连接池为事务模式，会话锁在池化连接上可能解不掉。同一动作成功后不会重复执行；失败后按 1、5、15 分钟退避，之后每 15 分钟重试一次，直到成功、店铺暂停/删除/改配置，或消息超过队列保留期（默认 24 小时）。每次重试都按当时应有状态执行，重复的相同失败每小时最多记录一条。定时消息按计划时刻（`scheduledAt`）判断开关，提前送达也不会漏掉开关点。凭据用 AES-256-GCM 加密。
- 每个时段联合区间的真实开/关边沿创建一个 Vercel Dynamic Schedule（按店铺 IANA 时区每日运行），只在边沿向 Vercel Queue 投递消息；不轮询 Neon。队列到达时重新按当前配置计算应有状态，迟到/过期 revision 会被忽略，重复投递由数据库动作键幂等处理。
- 修改计划先创建新 revision 的全部触发器，再切换数据库配置并清理旧触发器。创建失败时保留旧计划与 pending 状态，可从店铺卡片重试；删除失败时店铺保持停用并保留清理任务名供重试。广告当前状态同步通过队列触发。
- 页面提供三个时段预设（莫斯科时间 19:00–23:00、09:00–11:00、13:00–15:00），可以组合并修改到分钟。选择店铺时区后，预设会显示对应的本地时间；在莫斯科与北京时区间切换会平移已有时段，以保持同一实际时刻。
- 时段采用左闭右开规则：开始时刻起开启，到结束时刻关闭。开始晚于结束即跨午夜；两个时间不能相同。单店最多 8 段，重叠时段拒绝保存。
- 动态计划通过 `@vercel/schedules` 管理，Queue 消费者配置在 `vercel.json`。这两项 Vercel 能力处于 Beta，已在本项目团队的 Preview 上验证可调用及可投递；生产 Function 使用 Vercel OIDC，无需 `VERCEL_TOKEN`。Pro 下 Schedules 创建与运行以及 Queue 操作按量计费，不是固定免费服务；少量店铺每日数次边沿的预期用量很低，实际价格/额度以 [Vercel Schedules](https://vercel.com/docs/schedules) 和 [Queue 定价](https://vercel.com/docs/queues/pricing) 为准。
- 尚未进行真实 Ozon 广告开关调用。全商品开关影响该店铺在对应推广类型下的全部商品，请在添加真实凭据前确认此影响范围。

## 本地运行

Node.js 20+ 和 PostgreSQL。应用启动不会执行 DDL；首次安装需先创建原有 stores/job_runs 表，再执行版本化迁移。

```bash
npm install
cp .env.example .env.local
# 设置以下环境变量，再启动
npm run dev
```

必填变量：

- `DATABASE_URL`：PostgreSQL 连接 URI（需可从 Vercel Serverless Function 连接）。Neon PostgreSQL 已连接到生产环境。
- `DATABASE_URL_UNPOOLED`：可选，数据库直连 URI，用于需要店铺锁的操作。Vercel 的 Neon 集成会自动设置；未设置时使用 `DATABASE_URL`（本地无连接池的 PostgreSQL 即可）。
- `APP_SECRET`：base64 编码的 32 字节 AES key；可用 `openssl rand -base64 32` 生成。
- `SESSION_SECRET`：至少 32 字符的随机 session 签名密钥。
- `ADMIN_PASSWORD`：管理员登录密码。
- `OZ1_ADMIN_PASSWORD` 至 `OZ5_ADMIN_PASSWORD`：五个独立管理组口令；未设置时分别使用 `oz1` 至 `oz5`，生产环境建议覆盖为独立强口令。组管理员只能管理自己创建的店铺；全局管理员口令仍可查看和管理全部店铺。
- `CT_ADMIN_PASSWORD`：`ct` 组口令；未设置或为空时 `ct` 组不能登录，不提供默认口令。`ct` 组只能管理自己创建的店铺；各组口令必须互不相同。

`DATABASE_SSL` 默认遵循连接 URI 的 SSL 设置；设为 `require` 时启用证书校验，只有本地无 TLS PostgreSQL 才设为 `disable`。

## Vercel 部署与 GitHub 自动部署

1. 将 `main` 导入 Vercel；在 Vercel 项目中选择 Node 24 或 20。连接 GitHub 后，合并 PR 到 `main` 会触发生产部署。
2. Vercel Marketplace 已连接 Neon PostgreSQL，仅绑定 Production。数据库服务商的免费额度和条款以创建时页面为准。Preview 不绑定生产数据库或生产密钥；如果要让 Preview 可登录/执行，应另建独立免费数据库并设置 Preview 专用密钥。
3. 在 Vercel Production 环境设置独立随机的 `APP_SECRET`、`SESSION_SECRET`、`ADMIN_PASSWORD`。Preview 不配置生产密钥或生产数据库。不要把 `.env.local` 提交到仓库。可用 `openssl rand -base64 32` 生成 AES key、`openssl rand -hex 32` 生成其余随机值。
4. 为已连接的 Neon 数据库执行迁移：获取 Production `DATABASE_URL` 后运行 `npm run migrate`。每次发布不会在冷启动执行 DDL。若还未部署本工具的旧版本，需先创建 `stores`、`job_runs` 基础表再运行迁移。分组隔离通过 `004_store_groups` 增加 `owner_group`；`005_ct_store_group` 将 `ct` 加入可选归属组；既有店铺归全局管理员。
5. 部署 Production。Preview 不连接生产数据库，也不配置生产密钥。合并部署后，检查店铺卡片的计划同步状态；对于旧店铺需通过“重试同步”或更新计划以登记新动态触发器。

不要把 Preview 连接到生产数据库或复制生产密钥。合并删除静态 Cron 配置的部署后，旧 `/api/cron` 每分钟轮询任务将停止。
