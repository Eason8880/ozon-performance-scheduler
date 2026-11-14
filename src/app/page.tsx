"use client";

import { useEffect, useRef, useState } from "react";
import {
  convertTimeBetweenTimezones,
  convertWindowsBetweenTimezones,
  validateWindows,
  validTime,
} from "@/lib/windows";
import {
  describeAction,
  formatActionTime,
  type ActionSource,
} from "@/lib/action-log";

type TimeWindow = { start: string; stop: string };
type Preset = { id: string; title: string; moscow: TimeWindow };
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

const MOSCOW = "Europe/Moscow";
const BEIJING = "Asia/Shanghai";

const presets: Preset[] = [
  { id: "peak", title: "晚间高峰", moscow: { start: "19:00", stop: "23:00" } },
  { id: "morning", title: "傍晚", moscow: { start: "17:00", stop: "18:00" } },
  { id: "lunch", title: "午间", moscow: { start: "13:00", stop: "15:00" } },
];

/** Problems that keep a schedule from being fully in effect, in plain words. */
const scheduleProblems: Record<string, string> = {
  pending: "定时任务还没有创建完成，时段暂未生效。",
  syncing: "正在更新定时任务。如果长时间没有完成，请点击重试。",
  failed: "定时任务更新失败，新的时段没有生效。",
  cleanup_pending: "新时段已生效，但旧的定时任务还没有清理干净。",
  action_pending: "时段已保存，但推广还没有调整到当前应有的状态。",
  deleting: "店铺正在删除，定时任务还没有清理干净。",
  delete_pending: "店铺已停用，但定时任务还没有删除干净。",
};

function tzName(timezone: string) {
  return timezone === BEIJING ? "北京" : "莫斯科";
}
function otherTimezone(timezone: string) {
  return timezone === BEIJING ? MOSCOW : BEIJING;
}
function toMinute(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}
function validWindow(window: TimeWindow) {
  return (
    validTime(window.start) &&
    validTime(window.stop) &&
    window.start !== window.stop
  );
}

/** The same window read on the other clock, e.g. "北京 次日 00:00–04:00". */
function otherRange(window: TimeWindow, timezone: string) {
  const other = otherTimezone(timezone);
  const start = convertTimeBetweenTimezones(window.start, timezone, other);
  const stop = convertTimeBetweenTimezones(window.stop, timezone, other);
  const shifted =
    timezone === MOSCOW
      ? toMinute(start) < toMinute(window.start)
      : toMinute(start) > toMinute(window.start);
  const day = shifted ? (timezone === MOSCOW ? "次日 " : "前一日 ") : "";
  return `${tzName(other)} ${day}${start}–${stop}`;
}

function presetForTimezone(preset: Preset, timezone: string): TimeWindow {
  return timezone === MOSCOW
    ? preset.moscow
    : convertWindowsBetweenTimezones([preset.moscow], MOSCOW, timezone)[0];
}
function matches(a: TimeWindow, b: TimeWindow) {
  return a.start === b.start && a.stop === b.stop;
}

function clockParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const pick = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return { hour: pick("hour"), minute: pick("minute"), second: pick("second") };
}
function minuteOfDay(value: Date, timezone: string) {
  const { hour, minute } = clockParts(value, timezone);
  return Number(hour) * 60 + Number(minute);
}
function formatDay(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(value);
}
function formatLogTime(value: string, timezone: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

/** Whether the schedule says "on" at this minute, and when it next flips. */
function scheduleAt(windows: TimeWindow[], minute: number) {
  const valid = windows.filter(validWindow);
  if (valid.length === 0) return null;
  const current = valid.find((window) => {
    const start = toMinute(window.start);
    const stop = toMinute(window.stop);
    return start < stop
      ? minute >= start && minute < stop
      : minute >= start || minute < stop;
  });
  if (current) return { on: true, next: current.stop };
  const next = valid
    .map((window) => window.start)
    .sort(
      (a, b) =>
        ((toMinute(a) - minute + 1440) % 1440) -
        ((toMinute(b) - minute + 1440) % 1440),
    )[0];
  return { on: false, next };
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function TimezoneClocks() {
  const now = useNow(1_000);
  return (
    <div className="clocks" aria-label="当前时间">
      {[MOSCOW, BEIJING].map((timezone) => {
        const parts = now ? clockParts(now, timezone) : null;
        return (
          <div className="clock" key={timezone}>
            <span className="clock-city">{tzName(timezone)}时间</span>
            <time className="clock-time">
              {parts ? (
                <>
                  {parts.hour}:{parts.minute}
                  <span className="clock-seconds">:{parts.second}</span>
                </>
              ) : (
                "--:--"
              )}
            </time>
            <span className="clock-day">
              {now ? formatDay(now, timezone) : " "}
            </span>
          </div>
        );
      })}
      <p className="clocks-note">北京时间比莫斯科时间快 5 小时</p>
    </div>
  );
}

/** One day drawn as a bar: lit stretches are when the promotion is on. */
function DayStrip({
  windows,
  timezone,
  now,
  paused = false,
}: {
  windows: TimeWindow[];
  timezone: string;
  now: Date | null;
  paused?: boolean;
}) {
  const segments = windows.filter(validWindow).flatMap((window) => {
    const start = toMinute(window.start);
    const stop = toMinute(window.stop);
    return start < stop
      ? [{ start, stop }]
      : [
          { start, stop: 1440 },
          { start: 0, stop },
        ];
  });
  const nowMinute = now ? minuteOfDay(now, timezone) : null;
  return (
    <div className={`strip ${paused ? "paused" : ""}`} aria-hidden="true">
      <div className="strip-track">
        {segments.map((segment, index) => (
          <span
            className="strip-on"
            key={index}
            style={{
              left: `${(segment.start / 1440) * 100}%`,
              width: `${((segment.stop - segment.start) / 1440) * 100}%`,
            }}
          />
        ))}
        {nowMinute !== null && (
          <span
            className="strip-now"
            style={{ left: `${(nowMinute / 1440) * 100}%` }}
          />
        )}
      </div>
      <div className="strip-scale">
        {[0, 6, 12, 18, 24].map((hour) => (
          <span key={hour}>{hour}</span>
        ))}
      </div>
      <p className="strip-caption">
        {tzName(timezone)}时间 0–24 点，亮色为推广开启的时段
        {nowMinute !== null && "，竖线是现在"}
      </p>
    </div>
  );
}

function TimezoneSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (timezone: string) => void;
}) {
  return (
    <label className="field timezone-field">
      时段按哪个时区填写
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={MOSCOW}>莫斯科时间</option>
        <option value={BEIJING}>北京时间</option>
      </select>
      <small>切换后，已填的时段会自动换算，实际开关时刻不变。</small>
    </label>
  );
}

function WindowEditor({
  windows,
  timezone,
  now,
  onChange,
}: {
  windows: TimeWindow[];
  timezone: string;
  now: Date | null;
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
  function update(index: number, patch: Partial<TimeWindow>) {
    onChange(
      windows.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }
  const invalid = windows.length > 0 && !validateWindows(windows);
  return (
    <div className="window-editor">
      <div>
        <p className="field-title">常用时段，点击即可选用</p>
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
                  <span className="preset-time">
                    {tzName(timezone)} {value.start}–{value.stop}
                  </span>
                  <small>{otherRange(value, timezone)}</small>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <DayStrip windows={windows} timezone={timezone} now={now} />

      <div className="window-list">
        {windows.length === 0 && (
          <p className="empty-hint">
            还没有时段。选一个常用时段，或自己添加一个。
          </p>
        )}
        {windows.map((window, index) => (
          <div className="window-row" key={index}>
            <label>
              开启时间
              <input
                type="time"
                value={window.start}
                onChange={(event) =>
                  update(index, { start: event.target.value })
                }
                required
              />
            </label>
            <label>
              关闭时间
              <input
                type="time"
                value={window.stop}
                onChange={(event) =>
                  update(index, { stop: event.target.value })
                }
                required
              />
            </label>
            <span className="window-meta">
              {validWindow(window) ? (
                <>
                  {otherRange(window, timezone)}
                  {toMinute(window.start) > toMinute(window.stop) && (
                    <em>关闭时间在第二天</em>
                  )}
                </>
              ) : (
                <em className="warn">开启和关闭时间不能相同</em>
              )}
            </span>
            <button
              type="button"
              className="btn text danger"
              aria-label={`移除第 ${index + 1} 个时段`}
              onClick={() => onChange(windows.filter((_, i) => i !== index))}
            >
              移除
            </button>
          </div>
        ))}
      </div>

      {invalid && (
        <p className="alert" role="alert">
          时段之间有重叠，或某个时段的开启和关闭时间相同。请调整后再保存。
        </p>
      )}

      <button
        type="button"
        className="btn ghost add-window"
        disabled={windows.length >= 8}
        onClick={() =>
          onChange([...windows, { start: "17:00", stop: "18:00" }])
        }
      >
        添加一个时段
      </button>
      <p className="hint">
        每天到开启时间自动开启推广，到关闭时间自动关闭。关闭时间早于开启时间，表示跨到第二天。最多
        8 个时段，彼此不能重叠。
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
    timezone: MOSCOW,
  });
  const [form, F] = useState({
    name: "",
    clientId: "",
    clientSecret: "",
    windows: [] as TimeWindow[],
    timezone: MOSCOW,
  });
  const now = useNow(30_000);

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
        G(
          result.group === "admin"
            ? "管理员，可管理全部店铺"
            : `${result.group} 组，只能看到本组添加的店铺`,
        );
      }
    } catch (err) {
      if (generation !== pagingGeneration.current) return;
      E(
        err instanceof Error && err.message
          ? err.message
          : "无法连接服务，请稍后重试",
      );
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
      if (!response.ok)
        throw new Error(result.error || "记录没有加载出来，请重试");
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
          error:
            err instanceof Error ? err.message : "记录没有加载出来，请重试",
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
        E("口令不正确，请重新输入");
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
        E(result.error || "店铺没有添加成功，请重试");
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
    E("");
    I(store.id);
    EF({ windows: store.windows, timezone: store.timezone });
  }
  async function saveEdit(store: Store) {
    E("");
    B(true);
    try {
      const response = await fetch(`/api/stores/${store.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...editForm, enabled: store.enabled }),
      });
      const result = await response.json();
      if (!response.ok) {
        E(result.error || "时段没有保存成功，请重试");
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
    E("");
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
        E(
          store.enabled
            ? `「${store.name}」没有暂停成功，请重试`
            : `「${store.name}」没有恢复成功，请重试`,
        );
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
    if (
      !confirm(
        `删除店铺「${store.name}」？\n\n定时开关会停止，保存的 API 密钥也会一并删除。推广会停留在删除时的状态，之后需要到 Ozon 后台手动开关。`,
      )
    )
      return;
    E("");
    B(true);
    try {
      const response = await fetch(`/api/stores/${store.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        E(result?.error || `「${store.name}」没有删除成功，请重试`);
        await load();
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
        E(result.error || "定时任务更新失败，请稍后重试");
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
  function openAddDialog() {
    E("");
    addDialog.current?.showModal();
    ADO(true);
  }

  if (loading)
    return (
      <main className="wrap">
        <p className="loading">正在加载…</p>
      </main>
    );
  if (dbPending)
    return (
      <main className="wrap">
        <section className="gate">
          <p className="brand">Ozon 推广定时开关</p>
          <h1>还差一步：连接数据库</h1>
          <p>
            应用已经部署好，但还没有连接 PostgreSQL 数据库，暂时不能登录。请在
            Vercel 项目的环境变量中设置 <code>DATABASE_URL</code>
            ，重新部署后刷新本页。
          </p>
        </section>
      </main>
    );
  if (!authed)
    return (
      <main className="wrap">
        <section className="gate">
          <p className="brand">Ozon 推广定时开关</p>
          <h1>登录</h1>
          <p>
            登录后可以为店铺设置每天的投放时段，系统会到点自动开启和关闭「按订单付款」推广。
          </p>
          <form onSubmit={login}>
            <label className="field">
              登录口令
              <input
                type="password"
                value={password}
                onChange={(event) => P(event.target.value)}
                required
                autoFocus
              />
              <small>管理员和各小组使用各自的口令。</small>
            </label>
            <button className="btn primary" disabled={busy}>
              {busy ? "正在登录…" : "登录"}
            </button>
          </form>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
    );

  return (
    <main className="wrap">
      <header className="masthead">
        <div className="masthead-text">
          <h1>Ozon 推广定时开关</h1>
          <p>
            给每个店铺设置每天的投放时段：到开启时间自动打开「按订单付款」推广，到关闭时间自动关掉。开关对店铺内的全部商品生效。
          </p>
          <p className="identity">
            当前登录：{group}
            <button className="btn text" onClick={logout}>
              退出登录
            </button>
          </p>
        </div>
        <TimezoneClocks />
      </header>

      {error && !addDialogOpen && (
        <div className="alert banner" role="alert">
          <span>{error}</span>
          <button className="btn text" onClick={() => E("")}>
            知道了
          </button>
        </div>
      )}

      <section>
        <div className="section-head">
          <h2>
            店铺
            {stores.length > 0 && <span className="count">{stores.length}</span>}
          </h2>
          <div className="section-actions">
            <button className="btn ghost" onClick={() => void load()}>
              刷新
            </button>
            <button type="button" className="btn primary" onClick={openAddDialog}>
              添加店铺
            </button>
          </div>
        </div>

        {stores.length === 0 ? (
          <div className="empty">
            <h3>还没有店铺</h3>
            <p>
              添加店铺并设置投放时段后，系统会每天按时自动开启和关闭推广，不需要再手动操作。
            </p>
            <button type="button" className="btn primary" onClick={openAddDialog}>
              添加第一个店铺
            </button>
          </div>
        ) : (
          <div className="stores">
            {stores.map((store) => {
              const state =
                now && store.enabled
                  ? scheduleAt(store.windows, minuteOfDay(now, store.timezone))
                  : null;
              const problem =
                store.schedule_status &&
                !["active", "disabled"].includes(store.schedule_status)
                  ? (scheduleProblems[store.schedule_status] ??
                    "定时任务状态异常，请重试。")
                  : null;
              const deleting =
                store.schedule_status === "delete_pending" ||
                store.schedule_status === "deleting";
              const latest = store.runs?.[0];
              return (
                <article
                  className={`store ${store.enabled ? "" : "is-paused"}`}
                  key={store.id}
                >
                  <div className="store-head">
                    <h3>{store.name}</h3>
                    <span
                      className={`pill ${
                        !store.enabled ? "off" : state?.on ? "on" : "idle"
                      }`}
                    >
                      {!store.enabled
                        ? "定时已暂停"
                        : state
                          ? state.on
                            ? "现在：开启时段"
                            : "现在：关闭时段"
                          : "定时运行中"}
                    </span>
                  </div>

                  <p className="store-status">
                    {!store.enabled
                      ? "不会自动开关。推广停留在暂停时的状态，恢复定时后立即按时段调整。"
                      : state
                        ? `${
                            toMinute(state.next) <=
                            minuteOfDay(now!, store.timezone)
                              ? "明天 "
                              : ""
                          }${state.next} 自动${state.on ? "关闭" : "开启"}推广（${tzName(
                            otherTimezone(store.timezone),
                          )}时间 ${convertTimeBetweenTimezones(
                            state.next,
                            store.timezone,
                            otherTimezone(store.timezone),
                          )}）`
                        : " "}
                  </p>

                  <DayStrip
                    windows={store.windows}
                    timezone={store.timezone}
                    now={now}
                    paused={!store.enabled}
                  />

                  <ul className="window-chips">
                    {store.windows.map((window, index) => (
                      <li key={index}>
                        <strong>
                          {window.start}–{window.stop}
                        </strong>
                        <span>{otherRange(window, store.timezone)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="store-meta">
                    每天 {store.windows.length} 个投放时段，按
                    {tzName(store.timezone)}时间执行
                  </p>

                  {problem && (
                    <div className="alert" role="alert">
                      <div>
                        <strong>{problem}</strong>
                        {store.schedule_error && (
                          <small>技术信息：{store.schedule_error}</small>
                        )}
                      </div>
                      <button
                        className="btn ghost"
                        disabled={busy}
                        onClick={() =>
                          void (deleting
                            ? removeStore(store)
                            : retrySync(store))
                        }
                      >
                        {deleting ? "继续删除" : "重试"}
                      </button>
                    </div>
                  )}
                  {store.last_error && (
                    <p className="alert" role="alert">
                      最近一次自动开关没有成功：{store.last_error}
                    </p>
                  )}

                  {latest && (
                    <details className="logs">
                      <summary>
                        <span>
                          最近一次：
                          {describeAction(
                            latest.source,
                            latest.action,
                            latest.status,
                          )}
                          ，{tzName(store.timezone)}时间{" "}
                          {formatLogTime(latest.created_at, store.timezone)}
                        </span>
                        <span className="logs-toggle">查看执行记录</span>
                      </summary>
                      <ol>
                        {store.runs!.map((run) => (
                          <li
                            key={run.id}
                            className={run.status === "failed" ? "failed" : ""}
                            title={formatActionTime(
                              run.created_at,
                              store.timezone,
                            )}
                          >
                            <time>
                              {formatLogTime(run.created_at, store.timezone)}
                            </time>
                            <span>
                              {describeAction(
                                run.source,
                                run.action,
                                run.status,
                              )}
                              {run.status !== "success" && run.detail
                                ? `（${run.detail}）`
                                : ""}
                            </span>
                          </li>
                        ))}
                      </ol>
                      <p className="hint">
                        时间为{tzName(store.timezone)}
                        时间。鼠标停在某一条上，可以同时看到莫斯科和北京时间。
                      </p>
                      {runPages[store.id]?.hasMore && (
                        <button
                          type="button"
                          className="btn ghost"
                          disabled={runPages[store.id]?.loading}
                          aria-busy={runPages[store.id]?.loading}
                          onClick={() => void loadMoreRuns(store)}
                        >
                          {runPages[store.id]?.loading
                            ? "正在加载…"
                            : "加载更早的记录"}
                        </button>
                      )}
                      {runPages[store.id]?.error && (
                        <p className="alert" role="alert">
                          {runPages[store.id].error}
                        </p>
                      )}
                    </details>
                  )}

                  {editing === store.id ? (
                    <div className="editbox">
                      <h4>修改「{store.name}」的投放时段</h4>
                      <TimezoneSelect
                        value={editForm.timezone}
                        onChange={(timezone) =>
                          EF({
                            timezone,
                            windows: convertWindowsBetweenTimezones(
                              editForm.windows,
                              editForm.timezone,
                              timezone,
                            ),
                          })
                        }
                      />
                      <WindowEditor
                        windows={editForm.windows}
                        timezone={editForm.timezone}
                        now={now}
                        onChange={(windows) => EF({ ...editForm, windows })}
                      />
                      <div className="actions">
                        <button
                          className="btn primary"
                          disabled={busy || !validateWindows(editForm.windows)}
                          onClick={() => saveEdit(store)}
                        >
                          {busy ? "正在保存…" : "保存时段"}
                        </button>
                        <button className="btn ghost" onClick={() => I(null)}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="actions">
                      <button
                        className="btn ghost"
                        disabled={busy}
                        onClick={() => editStore(store)}
                      >
                        修改时段
                      </button>
                      <button
                        className="btn ghost"
                        disabled={busy}
                        onClick={() => toggleStore(store)}
                      >
                        {store.enabled ? "暂停定时" : "恢复定时"}
                      </button>
                      <button
                        className="btn text danger"
                        disabled={busy}
                        onClick={() => removeStore(store)}
                      >
                        删除店铺
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <dialog
        className="add-dialog"
        ref={addDialog}
        aria-labelledby="add-store-title"
        onClose={() => ADO(false)}
      >
        <div className="dialog-head">
          <h2 id="add-store-title">添加店铺</h2>
          <button
            className="btn text"
            type="button"
            onClick={() => addDialog.current?.close()}
          >
            关闭
          </button>
        </div>
        <form onSubmit={addStore}>
          <fieldset>
            <legend>
              <span className="step-no">1</span>填写店铺和 API 密钥
            </legend>
            <p className="hint">
              系统需要用 Ozon Performance API
              的密钥替你开关推广。添加时会先验证密钥是否可用，密钥加密后保存。
            </p>
            <div className="grid">
              <label className="field full-width">
                店铺名称
                <input
                  value={form.name}
                  onChange={(event) => F({ ...form, name: event.target.value })}
                  required
                  autoFocus
                />
                <small>只用来在这里区分店铺，可以自己起名。</small>
              </label>
              <label className="field">
                Client ID
                <input
                  value={form.clientId}
                  onChange={(event) =>
                    F({ ...form, clientId: event.target.value })
                  }
                  required
                  autoComplete="off"
                />
              </label>
              <label className="field">
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
            </div>
            <details className="credential-guide">
              <summary>不知道去哪里找这两项？查看图文步骤</summary>
              <ol className="credential-steps">
                {[
                  {
                    text: (
                      <>
                        登录这个店铺的 Ozon Seller 后台，打开{" "}
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
                      <>在服务账号列表里，点击刚创建的账号编号，进入详情。</>
                    ),
                    caption: "点击服务账号编号",
                  },
                  { text: <>点击“添加密钥”。</>, caption: "选择添加密钥" },
                  {
                    text: (
                      <>
                        密钥名称填 <strong>OPS</strong>，然后点击“添加”。
                      </>
                    ),
                    caption: "将密钥命名为 OPS 并添加",
                  },
                  {
                    text: (
                      <>
                        分别点击 Client ID 和 Client Secret
                        旁边的复制按钮，粘贴到上面对应的输入框。
                      </>
                    ),
                    caption: "复制 Client ID 和 Client Secret",
                  },
                ].map((step, index) => (
                  <li className="credential-step" key={step.caption}>
                    <p>
                      <span className="step-no">{index + 1}</span>
                      {step.text}
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
                      <figcaption>点击图片可以放大查看</figcaption>
                    </figure>
                  </li>
                ))}
              </ol>
              <p className="hint">
                注意三点：服务账号编号不是 Client ID；这里要的是 Performance
                API 的密钥，不是 Seller API 的密钥；Client Secret
                不要发给其他人。
              </p>
            </details>
          </fieldset>

          <fieldset>
            <legend>
              <span className="step-no">2</span>设置每天的投放时段
            </legend>
            <TimezoneSelect
              value={form.timezone}
              onChange={(timezone) =>
                F({
                  ...form,
                  timezone,
                  windows: convertWindowsBetweenTimezones(
                    form.windows,
                    form.timezone,
                    timezone,
                  ),
                })
              }
            />
            <WindowEditor
              windows={form.windows}
              timezone={form.timezone}
              now={now}
              onChange={(windows) => F({ ...form, windows })}
            />
          </fieldset>

          {error && addDialogOpen && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-foot">
            <p className="hint">
              添加后立即生效：系统会马上把推广调整到当前时段应有的状态，之后每天按时开关。
            </p>
            <button
              className="btn primary"
              disabled={busy || !validateWindows(form.windows)}
            >
              {busy ? "正在验证密钥…" : "验证密钥并添加"}
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
