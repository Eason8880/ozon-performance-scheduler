export type ActionSource =
  "scheduled" | "initial_sync" | "config_sync" | "state_sync" | "unknown";

export type ActionStatus = "success" | "failed" | string;

const sourceLabels: Record<
  Exclude<ActionSource, "scheduled" | "unknown">,
  string
> = {
  initial_sync: "添加店铺后校准",
  config_sync: "修改设置后校准",
  state_sync: "状态校准",
};

export function describeAction(
  source: ActionSource | null | undefined,
  action: string,
  status: ActionStatus,
) {
  const target = action === "activate" ? "开启" : "关闭";
  const succeeded = status === "success";
  if (source === "scheduled")
    return succeeded ? `按时${target}推广` : `按时${target}推广失败`;
  if (source && source in sourceLabels) {
    const label = sourceLabels[source as keyof typeof sourceLabels];
    return succeeded
      ? `${label}，推广已${target}`
      : `${label}失败，推广应为${target}`;
  }
  return succeeded ? `${target}推广` : `${target}推广失败`;
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
