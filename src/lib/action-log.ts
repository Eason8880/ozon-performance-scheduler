export type ActionSource =
  "scheduled" | "initial_sync" | "config_sync" | "state_sync" | "unknown";

export type ActionStatus = "success" | "failed" | string;

const sourceLabels: Record<
  Exclude<ActionSource, "scheduled" | "unknown">,
  string
> = {
  initial_sync: "初始同步",
  config_sync: "配置同步",
  state_sync: "状态同步",
};

export function describeAction(
  source: ActionSource | null | undefined,
  action: string,
  status: ActionStatus,
) {
  const target = action === "activate" ? "开启" : "关闭";
  const succeeded = status === "success";
  if (source === "scheduled")
    return `定时${target} · ${succeeded ? "成功" : "失败"}`;
  if (source && source in sourceLabels) {
    const label = sourceLabels[source as keyof typeof sourceLabels];
    return succeeded
      ? `${label}完成 · 状态${target}`
      : `${label}失败 · 目标状态${target}`;
  }
  return `执行${target} · ${succeeded ? "成功" : "失败"}`;
}

export function formatActionTime(value: string | Date, storeTimezone: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  const moscow = formatInTimezone(date, "Europe/Moscow");
  const beijing = formatInTimezone(date, "Asia/Shanghai");
  if (storeTimezone === "Asia/Shanghai")
    return `北京时间 ${beijing} · 莫斯科时间 ${moscow}`;
  return `莫斯科时间 ${moscow} · 北京时间 ${beijing}`;
}

function formatInTimezone(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(value);
}
