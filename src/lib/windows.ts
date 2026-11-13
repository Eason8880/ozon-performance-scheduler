export type TimeWindow = { start: string; stop: string };

export function validTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60;
}

function toMinute(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function validateWindows(value: unknown): value is TimeWindow[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8)
    return false;
  const segments: { start: number; stop: number }[] = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      !validTime(item.start) ||
      !validTime(item.stop) ||
      item.start === item.stop
    )
      return false;
    const start = toMinute(item.start);
    const stop = toMinute(item.stop);
    if (start < stop) segments.push({ start, stop });
    else {
      segments.push({ start, stop: 1440 });
      segments.push({ start: 0, stop });
    }
  }
  segments.sort((a, b) => a.start - b.start);
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].start < segments[i - 1].stop) return false;
  }
  return true;
}

export function validTimezone(
  value: unknown,
): value is "Europe/Moscow" | "Asia/Shanghai" {
  return value === "Europe/Moscow" || value === "Asia/Shanghai";
}

export function normalizeWindows(value: TimeWindow[]) {
  return value
    .map(({ start, stop }) => ({ start, stop }))
    .sort((a, b) => toMinute(a.start) - toMinute(b.start));
}

export function convertTimeBetweenTimezones(
  time: string,
  fromTimezone: string,
  toTimezone: string,
) {
  if (fromTimezone === toTimezone) return time;
  const offset = fromTimezone === "Europe/Moscow" ? 300 : -300;
  const value = (toMinute(time) + offset + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function convertWindowsBetweenTimezones(
  windows: TimeWindow[],
  fromTimezone: string,
  toTimezone: string,
) {
  return windows.map(({ start, stop }) => ({
    start: convertTimeBetweenTimezones(start, fromTimezone, toTimezone),
    stop: convertTimeBetweenTimezones(stop, fromTimezone, toTimezone),
  }));
}
