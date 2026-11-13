"use client";

import { useEffect, useState } from "react";
import {
  convertTimeBetweenTimezones,
  convertWindowsBetweenTimezones,
} from "@/lib/windows";

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
  runs?: {
    action_key: string;
    action: string;
    status: string;
    detail: string | null;
    created_at: string;
  }[];
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
    beijingLabel: "北京 14:00–16:00",
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
  const [error, E] = useState("");
  const [password, P] = useState("");
  const [busy, B] = useState(false);
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

  async function load() {
    L(true);
    try {
      const response = await fetch("/api/stores");
      const result = await response.json();
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
      }
    } catch (err) {
      E(err instanceof Error ? err.message : "连接失败");
    } finally {
      L(false);
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
        return;
      }
      F({ ...form, name: "", clientId: "", clientSecret: "", windows: [] });
      await load();
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
  async function logout() {
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
        </div>
        <button className="quiet" onClick={logout}>
          退出
        </button>
      </header>
      {error && <div className="error banner">{error}</div>}
      <section className="panel">
        <h2>授权店铺</h2>
        <p className="muted">
          添加时会验证 Performance API 凭据。客户端密钥仅以加密形式存储。
        </p>
        <form className="grid" onSubmit={addStore}>
          <label>
            店铺名称
            <input
              value={form.name}
              onChange={(event) => F({ ...form, name: event.target.value })}
              required
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
      </section>
      <section className="panel">
        <div className="row">
          <h2>店铺计划</h2>
          <button className="quiet" onClick={load}>
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
                {store.last_action_at && (
                  <p className="muted">
                    最近执行：{new Date(store.last_action_at).toLocaleString()}
                  </p>
                )}
                {store.last_error && (
                  <p className="error">最近执行失败：{store.last_error}</p>
                )}
                {store.runs && store.runs.length > 0 && (
                  <details className="logs">
                    <summary>最近执行记录</summary>
                    {store.runs.map((run, index) => (
                      <p
                        key={index}
                        className={run.status === "failed" ? "error" : "muted"}
                      >
                        {new Date(run.created_at).toLocaleString()} ·{" "}
                        {run.action === "activate" ? "开启" : "关闭"} ·{" "}
                        {run.status === "success"
                          ? "成功"
                          : run.detail || "失败"}
                      </p>
                    ))}
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
        Vercel Pro Cron 每分钟检查计划；时区计算基于店铺选择，不受服务器 UTC
        时区影响。
      </footer>
    </main>
  );
}
