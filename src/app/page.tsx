"use client";
import { useEffect, useState } from "react";
type Store = {
  id: string;
  name: string;
  timezone: string;
  start_time: string;
  stop_time: string;
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
export default function Home() {
  const [authed, A] = useState(false),
    [loading, L] = useState(true),
    [stores, S] = useState<Store[]>([]),
    [error, E] = useState(""),
    [password, P] = useState(""),
    [busy, B] = useState(false),
    [editing, I] = useState<string | null>(null),
    [editForm, EF] = useState({
      start: "",
      stop: "",
      timezone: "Europe/Moscow",
    }),
    [form, F] = useState({
      name: "",
      clientId: "",
      clientSecret: "",
      start: "09:00",
      stop: "21:00",
      timezone: "Europe/Moscow",
    });
  async function load() {
    L(true);
    try {
      const r = await fetch("/api/stores");
      if (r.status === 401) {
        A(false);
      } else {
        A(true);
        const j = await r.json();
        if (!r.ok) throw Error(j.error);
        S(j.stores);
        A(true);
      }
    } catch (e) {
      E(e instanceof Error ? e.message : "连接失败");
    } finally {
      L(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    E("");
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!r.ok) {
      E("密码错误");
      return;
    }
    P("");
    await load();
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    E("");
    B(true);
    try {
      const r = await fetch("/api/stores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) {
        E(j.error || "添加失败");
        return;
      }
      F({ ...form, name: "", clientId: "", clientSecret: "" });
      await load();
    } catch {
      E("无法连接服务，请稍后重试");
    } finally {
      B(false);
    }
  }
  function edit(s: Store) {
    I(s.id);
    EF({
      start: s.start_time.slice(0, 5),
      stop: s.stop_time.slice(0, 5),
      timezone: s.timezone,
    });
  }
  async function saveEdit(s: Store) {
    B(true);
    try {
      const r = await fetch(`/api/stores/${s.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...editForm, enabled: s.enabled }),
      });
      const j = await r.json();
      if (!r.ok) {
        E(j.error);
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
  async function toggle(s: Store) {
    B(true);
    try {
      const r = await fetch(`/api/stores/${s.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          start: s.start_time.slice(0, 5),
          stop: s.stop_time.slice(0, 5),
          timezone: s.timezone,
          enabled: !s.enabled,
        }),
      });
      if (!r.ok) {
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
  async function remove(s: Store) {
    if (!confirm(`删除店铺“${s.name}”及其凭据？`)) return;
    B(true);
    try {
      const r = await fetch(`/api/stores/${s.id}`, { method: "DELETE" });
      if (!r.ok) {
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
                onChange={(e) => P(e.target.value)}
                required
                autoFocus
              />
            </label>
            <button>登录</button>
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
          <p>
            每天在设定时间统一开启或关闭“全部商品”推广。时间按每个店铺的时区计算。
          </p>
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
        <form className="grid" onSubmit={add}>
          <label>
            店铺名称
            <input
              value={form.name}
              onChange={(e) => F({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label>
            Performance Client ID
            <input
              value={form.clientId}
              onChange={(e) => F({ ...form, clientId: e.target.value })}
              required
              autoComplete="off"
            />
          </label>
          <label>
            Client Secret
            <input
              type="password"
              value={form.clientSecret}
              onChange={(e) => F({ ...form, clientSecret: e.target.value })}
              required
              autoComplete="new-password"
            />
          </label>
          <label>
            时区
            <select
              value={form.timezone}
              onChange={(e) => F({ ...form, timezone: e.target.value })}
            >
              <option value="Asia/Shanghai">
                中国标准时间（Asia/Shanghai）
              </option>
              <option value="Europe/Moscow">莫斯科时间（Europe/Moscow）</option>
            </select>
          </label>
          <label>
            每天开启
            <input
              type="time"
              value={form.start}
              onChange={(e) => F({ ...form, start: e.target.value })}
              required
            />
          </label>
          <label>
            每天关闭
            <input
              type="time"
              value={form.stop}
              onChange={(e) => F({ ...form, stop: e.target.value })}
              required
            />
          </label>
          <button className="submit" disabled={busy}>
            验证并添加店铺
          </button>
        </form>
        <p className="note">
          开始时间晚于结束时间时，按跨午夜时段处理。两个时间不能相同。此设置作用于
          Ozon Performance 中的全部商品。
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
            {stores.map((s) => (
              <article className="store" key={s.id}>
                <div className="row">
                  <div>
                    <h3>{s.name}</h3>
                    <span className="muted">{s.timezone}</span>
                  </div>
                  <span className={s.enabled ? "badge on" : "badge"}>
                    {s.enabled ? "自动计划开启" : "已暂停"}
                  </span>
                </div>
                <p className="hours">
                  {s.start_time.slice(0, 5)} → {s.stop_time.slice(0, 5)}{" "}
                  <small>每天</small>
                </p>
                {s.last_action_at && (
                  <p className="muted">
                    最近执行：{new Date(s.last_action_at).toLocaleString()}
                  </p>
                )}
                {s.last_error && (
                  <p className="error">最近执行失败：{s.last_error}</p>
                )}
                {s.runs && s.runs.length > 0 && (
                  <details className="logs">
                    <summary>最近执行记录</summary>
                    {s.runs.map((run, i) => (
                      <p
                        key={i}
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
                {editing === s.id && (
                  <div className="editbox grid">
                    <label>
                      每天开启
                      <input
                        type="time"
                        value={editForm.start}
                        onChange={(e) =>
                          EF({ ...editForm, start: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      每天关闭
                      <input
                        type="time"
                        value={editForm.stop}
                        onChange={(e) =>
                          EF({ ...editForm, stop: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      时区
                      <select
                        value={editForm.timezone}
                        onChange={(e) =>
                          EF({ ...editForm, timezone: e.target.value })
                        }
                      >
                        <option value="Europe/Moscow">莫斯科时间</option>
                        <option value="Asia/Shanghai">中国标准时间</option>
                      </select>
                    </label>
                    <div className="actions">
                      <button disabled={busy} onClick={() => saveEdit(s)}>
                        保存
                      </button>
                      <button className="quiet" onClick={() => I(null)}>
                        取消
                      </button>
                    </div>
                  </div>
                )}
                <div className="actions">
                  <button className="quiet" onClick={() => edit(s)}>
                    修改时间
                  </button>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => toggle(s)}
                  >
                    {s.enabled ? "暂停计划" : "启用计划"}
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => remove(s)}
                  >
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <footer>自动执行依赖部署时配置的分钟级调度器和 PostgreSQL。</footer>
    </main>
  );
}
