"use client";

import { useEffect, useRef, useState } from "react";
import {
  convertTimeBetweenTimezones,
  convertWindowsBetweenTimezones,
} from "@/lib/windows";
import {
  describeAction,
  formatActionTime,
  type ActionSource,
} from "@/lib/action-log";

type TimeWindow = { start: string; stop: string };
type Preset = {
  id: string;
  title: string;
  moscow: TimeWindow;
  beijingLabel: string;
};
type Store = {
  id: string;
  name: string;
  timezone: string;
  windows: TimeWindow[];
  enabled: boolean;
  last_action_at: string | null;
  last_error: string | null;
  last_action_key?: string | null;
  schedule_status?: string;
  schedule_error?: string | null;
  runs?: {
    id: string;
    action_key: string;
    action: string;
    status: string;
    detail: string | null;
    source: ActionSource;
    created_at: string;
  }[];
  runsHasMore?: boolean;
  runsNextCursor?: string | null;
};
type RunPageState = {
  cursor: string | null;
  hasMore: boolean;
  loading: boolean;
  error: string;
};

const presets: Preset[] = [
  {
    id: "peak",
    title: "主要高峰",
    moscow: { start: "19:00", stop: "23:00" },
    beijingLabel: "北京次日 00:00–04:00",
  },
  {
    id: "morning",
    title: "上午时段",
    moscow: { start: "17:00", stop: "18:00" },
    beijingLabel: "北京 22:00–23:00",
  },
  {
    id: "lunch",
    title: "午间时段",
    moscow: { start: "13:00", stop: "15:00" },
    beijingLabel: "北京 18:00–20:00",
  },
];

function shiftWindows(windows: TimeWindow[], from: string, to: string) {
  return convertWindowsBetweenTimezones(windows, from, to);
}
function presetForTimezone(preset: Preset, timezone: string): TimeWindow {
  return timezone === "Europe/Moscow"
    ? preset.moscow
    : {
        start: convertTimeBetweenTimezones(
          preset.moscow.start,
          "Europe/Moscow",
          "Asia/Shanghai",
        ),
        stop: convertTimeBetweenTimezones(
          preset.moscow.stop,
          "Europe/Moscow",
          "Asia/Shanghai",
        ),
      };
}
function matches(a: TimeWindow, b: TimeWindow) {
  return a.start === b.start && a.stop === b.stop;
}

function formatClockTime(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

function TimezoneClocks() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="timezone-clocks" aria-label="当前时间">
      <div>
        <span>北京时间</span>
        <time>{now ? formatClockTime(now, "Asia/Shanghai") : "载入中…"}</time>
      </div>
      <div>
        <span>莫斯科时间</span>
        <time>{now ? formatClockTime(now, "Europe/Moscow") : "载入中…"}</time>
      </div>
    </div>
  );
}

function WindowEditor({
  windows,
  timezone,
  onChange,
}: {
  windows: TimeWindow[];
  timezone: string;
  onChange: (windows: TimeWindow[]) => void;
}) {
  function togglePreset(preset: Preset) {
    const selected = presetForTimezone(preset, timezone);
    const existing = windows.findIndex((window) => matches(window, selected));
    onChange(
      existing >= 0
        ? windows.filter((_, index) => index !== existing)
        : [...windows, selected],
    );
  }
  return (
    <div className="window-editor">
      <div className="preset-grid">
        {presets.map((preset) => {
          const value = presetForTimezone(preset, timezone);
          const checked = windows.some((window) => matches(window, value));
          return (
            <label
              className={`preset ${checked ? "selected" : ""}`}
              key={preset.id}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => togglePreset(preset)}
              />
              <span>
                <strong>{preset.title}</strong>
                <small>
                  莫斯科 {preset.moscow.start}–{preset.moscow.stop} /{" "}
                  {preset.beijingLabel}
                </small>
                {timezone === "Europe/Moscow" && (
                  <small>
                    当前店铺时间：{value.start}–{value.stop}
                  </small>
                )}
              </span>
            </label>
          );
        })}
      </div>
      <div className="window-list">
        {windows.length === 0 && (
          <p className="muted">请选择高峰时段，或添加自定义时段。</p>
        )}
        {windows.map((window, index) => (
          <div
            className="window-row"
            key={`${index}-${window.start}-${window.stop}`}
          >
            <span className="window-label">时段 {index + 1}</span>
            <label>
              开始
              <input
                type="time"
                value={window.start}
                onChange={(event) =>
                  onChange(
                    windows.map((item, i) =>
                      i === index
                        ? { ...item, start: event.target.value }
                        : item,
                    ),
                  )
                }
                required
              />
            </label>
            <label>
              结束
              <input
                type="time"
                value={window.stop}
                onChange={(event) =>
                  onChange(
                    windows.map((item, i) =>
                      i === index
                        ? { ...item, stop: event.target.value }
                        : item,
                    ),
                  )
                }
                required
              />
            </label>
            <button
              type="button"
              className="danger"
              aria-label={`移除时段 ${index + 1}`}
              onClick={() => onChange(windows.filter((_, i) => i !== index))}
            >
              移除
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="quiet add-window"
        disabled={windows.length >= 8}
        onClick={() =>
          onChange([...windows, { start: "17:00", stop: "18:00" }])
        }
      >
        + 添加自定义时段
      </button>
      <p className="note">
        店铺时区：{timezone}
        。切换时区会平移现有时段以保持同一时刻。每个时段支持跨午夜；重叠时段需要先调整到不重叠。
      </p>
    </div>
  );
}

export default function Home() {
  const [authed, A] = useState(false);
  const [dbPending, DP] = useState(false);
  const [loading, L] = useState(true);
  const [stores, S] = useState<Store[]>([]);
  const [runPages, setRunPages] = useState<Record<string, RunPageState>>({});
  const pagingGeneration = useRef(0);
  const pagingRequests = useRef(new Map<string, number>());
  const pagingSequence = useRef(0);
  const [group, G] = useState("");
  const [error, E] = useState("");
  const [password, P] = useState("");
  const [busy, B] = useState(false);
  const [addDialogOpen, ADO] = useState(false);
  const addDialog = useRef<HTMLDialogElement>(null);
  const [editing, I] = useState<string | null>(null);
  const [editForm, EF] = useState({
    windows: [] as TimeWindow[],
    timezone: "Europe/Moscow",
  });
  const [form, F] = useState({
    name: "",
    clientId: "",
    clientSecret: "",
    windows: [] as TimeWindow[],
    timezone: "Europe/Moscow",
  });

  async function load(showLoading = true) {
    const generation = ++pagingGeneration.current;
    pagingRequests.current.clear();
    setRunPages((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, page]) => [
          id,
          { ...page, loading: false },
        ]),
      ),
    );
    if (showLoading) L(true);
    try {
      const response = await fetch("/api/stores");
      const result = await response.json();
      if (generation !== pagingGeneration.current) return;
      if (result.code === "DATABASE_PENDING") {
        DP(true);
        A(false);
      } else if (response.status === 401) {
        DP(false);
        A(false);
      } else {
        DP(false);
        A(true);
        if (!response.ok) throw Error(result.error);
        S(result.stores);
        setRunPages(
          Object.fromEntries(
            result.stores.map((store: Store) => [
              store.id,
              {
                cursor: store.runsNextCursor ?? null,
                hasMore: Boolean(store.runsHasMore),
                loading: false,
                error: "",
              },
            ]),
          ),
        );
        G(result.group === "admin" ? "全局管理员" : `管理组 ${result.group}`);
      }
    } catch (err) {
      if (generation !== pagingGeneration.current) return;
      E(err instanceof Error ? err.message : "连接失败");
    } finally {
      if (showLoading && generation === pagingGeneration.current) L(false);
    }
  }

  async function loadMoreRuns(store: Store) {
    const page = runPages[store.id];
    if (
      !page?.hasMore ||
      page.loading ||
      !page.cursor ||
      pagingRequests.current.has(store.id)
    )
      return;
    const generation = pagingGeneration.current;
    const requestId = ++pagingSequence.current;
    pagingRequests.current.set(store.id, requestId);
    setRunPages((current) => ({
      ...current,
      [store.id]: { ...(current[store.id] ?? page), loading: true, error: "" },
    }));
    try {
      const response = await fetch(
        `/api/stores/${store.id}/runs?cursor=${encodeURIComponent(page.cursor)}`,
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "读取失败，请重试");
      if (
        generation !== pagingGeneration.current ||
        pagingRequests.current.get(store.id) !== requestId
      )
        return;
      S((current) =>
        current.map((item) => {
          if (item.id !== store.id) return item;
          const existing = item.runs ?? [];
          const seen = new Set(existing.map((run) => run.id));
          const appended = result.items.filter(
            (run: NonNullable<Store["runs"]>[number]) => !seen.has(run.id),
          );
          return { ...item, runs: [...existing, ...appended] };
        }),
      );
      setRunPages((current) => ({
        ...current,
        [store.id]: {
          cursor: result.nextCursor,
          hasMore: result.hasMore,
          loading: false,
          error: "",
        },
      }));
    } catch (err) {
      if (
        generation !== pagingGeneration.current ||
        pagingRequests.current.get(store.id) !== requestId
      )
        return;
      setRunPages((current) => ({
        ...current,
        [store.id]: {
          ...(current[store.id] ?? page),
          loading: false,
          error: err instanceof Error ? err.message : "读取失败，请重试",
        },
      }));
    } finally {
      if (pagingRequests.current.get(store.id) === requestId)
        pagingRequests.current.delete(store.id);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    E("");
    B(true);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        E("密码错误");
        return;
      }
      P("");
      await load();
    } catch {
      E("无法连接服务，请稍后重试");
    } finally {
      B(false);
    }
  }

  async function addStore(event: React.FormEvent) {
    event.preventDefault();
    E("");
    B(true);
    try {
      const response = await fetch("/api/stores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) {
        E(result.error || "添加失败");
        if (result.store) {
          F({ ...form, name: "", clientId: "", clientSecret: "", windows: [] });
          addDialog.current?.close();
          ADO(false);
          await load(false);
        }
        return;
      }
      F({ ...form, name: "", clientId: "", clientSecret: "", windows: [] });
      addDialog.current?.close();
      ADO(false);
      await load(false);
    } catch {
      E("无法连接服务，请稍后重试");
    } finally {
      B(false);
    }
  }

  function editStore(store: Store) {
    I(store.id);
    EF({ windows: store.windows, timezone: store.timezone });
  }
  async function saveEdit(store: Store) {
    B(true);
    try {
      const response = await fetch(`/api/stores/${store.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...editForm, enabled: store.enabled }),
      });
      const result = await response.json();
      if (!response.ok) {
        E(result.error);
        return;
      }
      I(null);
      await load();
    } catch {
      E("无法连接服务，请稍后重试");
    } finally {
      B(false);
    }
  }
  async function toggleStore(store: Store) {
    B(true);
    try {
      const response = await fetch(`/api/stores/${store.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          windows: store.windows,
          timezone: store.timezone,
          enabled: !store.enabled,
        }),
      });
      if (!response.ok) {
        E("更新失败");
        return;
      }
      await load();
    } catch {
      E("无法连接服务，请稍后重试");
    } finally {
      B(false);
    }
  }
  async function removeStore(store: Store) {
    if (!confirm(`删除店铺“${store.name}”及其凭据？`)) return;
    B(true);
    try {
      const response = await fetch(`/api/stores/${store.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        E("删除失败");
        return;
      }
      await load();
    } catch {
      E("无法连接服务，请稍后重试");
    } finally {
      B(false);
    }
  }
  async function retrySync(store: Store) {
    B(true);
    E("");
    try {
      const response = await fetch(`/api/stores/${store.id}/sync`, {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) {
        E(result.error || "计划同步失败");
        return;
      }
      await load();
    } catch {
      E("无法连接服务，请稍后重试");
    } finally {
      B(false);
    }
  }
  async function logout() {
    pagingGeneration.current += 1;
    pagingRequests.current.clear();
    setRunPages({});
    await fetch("/api/logout", { method: "POST" });
    A(false);
  }

  if (loading) return <main className="wrap">正在载入…</main>;
  if (dbPending)
    return (
      <main className="wrap">
        <section className="panel login">
          <div className="eyebrow">OZON PERFORMANCE</div>
          <h1>正在完成数据库配置</h1>
          <p>
            应用代码已部署。连接 PostgreSQL 后即可登录、保存店铺并运行计划。
          </p>
        </section>
      </main>
    );
  if (!authed)
    return (
      <main className="wrap">
        <section className="panel login">
          <div className="eyebrow">OZON PERFORMANCE</div>
          <h1>广告时间开关</h1>
          <p>管理员登录后管理店铺每日投放时段。</p>
          <form onSubmit={login}>
            <label>
              管理员密码
              <input
                type="password"
                value={password}
                onChange={(event) => P(event.target.value)}
                required
                autoFocus
              />
            </label>
            <button disabled={busy}>登录</button>
          </form>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );

  return (
    <main className="wrap">
      <header>
        <div>
          <div className="eyebrow">OZON PERFORMANCE</div>
          <h1>按订单付款推广计划</h1>
          <p>组合多个每日时段，在选定时区为店铺开启或关闭全部商品推广。</p>
          <p className="muted">当前身份：{group}</p>
          <TimezoneClocks />
        </div>
        <button className="quiet" onClick={logout}>
          退出
        </button>
      </header>
      <section className="panel">
        <div className="row">
          <div>
            <h2>授权店铺</h2>
            <p className="muted">添加并管理已授权店铺。</p>
          </div>
          <button
            type="button"
            onClick={() => {
              E("");
              addDialog.current?.showModal();
              ADO(true);
            }}
          >
            添加授权店铺
          </button>
        </div>
      </section>
      <dialog
        className="add-dialog"
        ref={addDialog}
        aria-labelledby="add-store-title"
        onClose={() => ADO(false)}
      >
        <div className="row dialog-heading">
          <div>
            <h2 id="add-store-title">添加授权店铺</h2>
            <p className="muted">
              添加时会验证 Performance API 凭据。客户端密钥仅以加密形式存储。
            </p>
          </div>
          <button
            className="quiet"
            type="button"
            aria-label="关闭"
            onClick={() => addDialog.current?.close()}
          >
            关闭
          </button>
        </div>
        <details className="credential-guide">
          <summary>
            如何获取 Performance API 的 Client ID 和 Client Secret
          </summary>
          <ol className="credential-steps">
            {[
              {
                text: (
                  <>
                    登录对应的 Ozon Seller 店铺，打开{" "}
                    <a
                      href="https://seller.ozon.ru/app/settings/performance-api"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Performance API 页面
                    </a>
                    ，点击“创建账户”。
                  </>
                ),
                caption: "创建 Performance API 服务账号",
              },
              {
                text: (
                  <>在服务账号列表中点击刚创建的服务账号编号，进入账号详情。</>
                ),
                caption: "点击服务账号编号",
              },
              { text: <>点击“添加密钥”。</>, caption: "选择添加密钥" },
              {
                text: (
                  <>
                    在密钥名称中填写 <strong>OPS</strong>，然后点击“添加”。
                  </>
                ),
                caption: "将密钥命名为 OPS 并添加",
              },
              {
                text: <>分别点击 Client ID 和 Client Secret 旁的复制按钮。</>,
                caption: "复制 Client ID 和 Client Secret",
              },
            ].map((step, index) => (
              <li className="credential-step" key={step.caption}>
                <p>
                  <strong>步骤 {index + 1}.</strong> {step.text}
                </p>
                <figure>
                  <a
                    href={`/credential-guide/step-${index + 1}.png`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={`/credential-guide/step-${index + 1}.png`}
                      alt={`步骤 ${index + 1}：${step.caption}`}
                    />
                  </a>
                  <figcaption>{step.caption}（点击图片可放大）</figcaption>
                </figure>
              </li>
            ))}
          </ol>
          <p>
            复制完成后，将 Client ID 和 Client Secret 分别粘贴到下方对应字段。
          </p>
          <p className="note">
            服务账号编号只是进入账号详情的入口，不是 Client ID。本表单使用
            Performance API 服务账号密钥；请勿与 Seller API 密钥混淆，也不要分享
            Client Secret。
          </p>
        </details>
        <form className="grid" onSubmit={addStore}>
          <label>
            店铺名称
            <input
              value={form.name}
              onChange={(event) => F({ ...form, name: event.target.value })}
              required
              autoFocus
            />
          </label>
          <label>
            Performance Client ID
            <input
              value={form.clientId}
              onChange={(event) => F({ ...form, clientId: event.target.value })}
              required
              autoComplete="off"
            />
          </label>
          <label>
            Client Secret
            <input
              type="password"
              value={form.clientSecret}
              onChange={(event) =>
                F({ ...form, clientSecret: event.target.value })
              }
              required
              autoComplete="new-password"
            />
          </label>
          <label>
            店铺时区
            <select
              value={form.timezone}
              onChange={(event) => F({ ...form, timezone: event.target.value })}
            >
              <option value="Europe/Moscow">莫斯科时间（Europe/Moscow）</option>
              <option value="Asia/Shanghai">
                中国标准时间（Asia/Shanghai）
              </option>
            </select>
          </label>
          <div className="full-width">
            <WindowEditor
              windows={form.windows}
              timezone={form.timezone}
              onChange={(windows) => F({ ...form, windows })}
            />
          </div>
          <button
            className="submit"
            disabled={busy || form.windows.length === 0}
          >
            验证凭据并添加店铺
          </button>
        </form>
        <p className="note">
          预设时段仅供参考。开启时段按左闭右开计算；多个时段会合并判断，重叠输入会被拒绝。
        </p>
        {error && addDialogOpen && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </dialog>
      {error && !addDialogOpen && <div className="error banner">{error}</div>}
      <section className="panel">
        <div className="row">
          <h2>店铺计划</h2>
          <button className="quiet" onClick={() => void load()}>
            刷新
          </button>
        </div>
        {stores.length === 0 ? (
          <p className="muted">还没有添加店铺。</p>
        ) : (
          <div className="cards">
            {stores.map((store) => (
              <article className="store" key={store.id}>
                <div className="row">
                  <div>
                    <h3>{store.name}</h3>
                    <span className="muted">{store.timezone}</span>
                  </div>
                  <span className={store.enabled ? "badge on" : "badge"}>
                    {store.enabled ? "自动计划开启" : "已暂停"}
                  </span>
                </div>
                <div className="store-windows">
                  {store.windows.map((window, index) => (
                    <span key={index}>
                      {window.start}–{window.stop}
                    </span>
                  ))}
                  <small>每天 · {store.windows.length} 个时段</small>
                </div>
                {store.runs?.[0] && (
                  <p className="muted">
                    最近结果：
                    {describeAction(
                      store.runs[0].source,
                      store.runs[0].action,
                      store.runs[0].status,
                    )}{" "}
                    ·{" "}
                    {formatActionTime(store.runs[0].created_at, store.timezone)}
                  </p>
                )}
                {store.schedule_status &&
                  !["active", "disabled"].includes(store.schedule_status) && (
                    <div className="error">
                      计划状态：{store.schedule_status}
                      {store.schedule_error && ` · ${store.schedule_error}`}
                      <button
                        className="quiet"
                        disabled={busy}
                        onClick={() =>
                          void (store.schedule_status === "delete_pending" ||
                          store.schedule_status === "deleting"
                            ? removeStore(store)
                            : retrySync(store))
                        }
                      >
                        {store.schedule_status === "delete_pending" ||
                        store.schedule_status === "deleting"
                          ? "重试删除"
                          : "重试同步"}
                      </button>
                    </div>
                  )}
                {store.last_error && (
                  <p className="error">最近执行失败：{store.last_error}</p>
                )}
                {store.runs && store.runs.length > 0 && (
                  <details className="logs">
                    <summary>最近记录（店铺时区 / 北京时间）</summary>
                    {store.runs.map((run) => (
                      <p
                        key={run.id}
                        className={run.status === "failed" ? "error" : "muted"}
                      >
                        {formatActionTime(run.created_at, store.timezone)} ·{" "}
                        {describeAction(run.source, run.action, run.status)}
                        {run.status !== "success" && run.detail
                          ? ` · ${run.detail}`
                          : ""}
                      </p>
                    ))}
                    {runPages[store.id]?.hasMore && (
                      <button
                        type="button"
                        className="quiet"
                        disabled={runPages[store.id]?.loading}
                        aria-busy={runPages[store.id]?.loading}
                        onClick={() => void loadMoreRuns(store)}
                      >
                        {runPages[store.id]?.loading ? "正在加载…" : "加载更多"}
                      </button>
                    )}
                    {runPages[store.id]?.error && (
                      <p className="error" role="alert">
                        {runPages[store.id].error}
                      </p>
                    )}
                  </details>
                )}
                {editing === store.id && (
                  <div className="editbox">
                    <label className="timezone-label">
                      店铺时区
                      <select
                        value={editForm.timezone}
                        onChange={(event) =>
                          EF({
                            ...editForm,
                            timezone: event.target.value,
                            windows: shiftWindows(
                              editForm.windows,
                              editForm.timezone,
                              event.target.value,
                            ),
                          })
                        }
                      >
                        <option value="Europe/Moscow">
                          莫斯科时间（Europe/Moscow）
                        </option>
                        <option value="Asia/Shanghai">
                          中国标准时间（Asia/Shanghai）
                        </option>
                      </select>
                    </label>
                    <WindowEditor
                      windows={editForm.windows}
                      timezone={editForm.timezone}
                      onChange={(windows) => EF({ ...editForm, windows })}
                    />
                    <div className="actions">
                      <button
                        disabled={busy || editForm.windows.length === 0}
                        onClick={() => saveEdit(store)}
                      >
                        保存修改
                      </button>
                      <button className="quiet" onClick={() => I(null)}>
                        取消
                      </button>
                    </div>
                  </div>
                )}
                <div className="actions">
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => editStore(store)}
                  >
                    修改时段
                  </button>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => toggleStore(store)}
                  >
                    {store.enabled ? "暂停计划" : "启用计划"}
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => removeStore(store)}
                  >
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <footer>
        按店铺时区在开关时间执行计划；时区计算不受服务器 UTC 时区影响。
      </footer>
    </main>
  );
}
