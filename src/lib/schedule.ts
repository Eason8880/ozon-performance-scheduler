import type { TimeWindow } from "./windows";

function localParts(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function pseudoDay(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}
function dateFromDay(day: number) {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}
function minuteOf(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function desiredState(now: Date, tz: string, windows: TimeWindow[]) {
  const local = localParts(now, tz);
  const current = pseudoDay(local.date) * 1440 + local.minute;
  if (windows.length === 0) return { active: false, key: "off:no-windows" };
  const dailySegments = windows
    .flatMap((window) => {
      const start = minuteOf(window.start);
      const stop = minuteOf(window.stop);
      return start < stop
        ? [{ start, stop }]
        : [
            { start: 0, stop },
            { start, stop: 1440 },
          ];
    })
    .sort((a, b) => a.start - b.start);
  let coveredUntil = 0;
  for (const segment of dailySegments) {
    if (segment.start > coveredUntil) break;
    coveredUntil = Math.max(coveredUntil, segment.stop);
  }
  if (coveredUntil >= 1440) return { active: true, key: "on:continuous" };
  const intervals: { start: number; stop: number }[] = [];
  for (
    let day = pseudoDay(local.date) - 2;
    day <= pseudoDay(local.date) + 1;
    day++
  ) {
    for (const window of windows) {
      const start = minuteOf(window.start);
      const stop = minuteOf(window.stop);
      const begin = day * 1440 + start;
      intervals.push({
        start: begin,
        stop: day * 1440 + (start < stop ? stop : 1440 + stop),
      });
    }
  }
  const isActive = (minute: number) =>
    intervals.some(
      (interval) => minute >= interval.start && minute < interval.stop,
    );
  const active = isActive(current);
  const edges = [
    ...new Set(
      intervals.flatMap((interval) => [interval.start, interval.stop]),
    ),
  ]
    .filter((edge) => edge <= current && isActive(edge - 1) !== isActive(edge))
    .sort((a, b) => b - a);
  if (edges.length === 0 && active)
    return { active: true, key: "on:continuous" };
  const edge = edges[0] ?? current;
  const edgeDay = Math.floor(edge / 1440);
  const edgeMinute = edge - edgeDay * 1440;
  const hh = String(Math.floor(edgeMinute / 60)).padStart(2, "0");
  const mm = String(edgeMinute % 60).padStart(2, "0");
  return {
    active,
    key: `${active ? "on" : "off"}:${dateFromDay(edgeDay)}T${hh}:${mm}`,
  };
}
