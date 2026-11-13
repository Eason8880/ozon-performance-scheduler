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
  const p = Object.fromEntries(
    fmt.formatToParts(date).map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minute: Number(p.hour) * 60 + Number(p.minute),
  };
}
export function desiredState(
  now: Date,
  tz: string,
  start: string,
  stop: string,
) {
  const l = localParts(now, tz);
  const [sh, sm] = start.split(":").map(Number),
    [eh, em] = stop.split(":").map(Number);
  const a = sh * 60 + sm,
    b = eh * 60 + em;
  const active =
    a < b ? l.minute >= a && l.minute < b : l.minute >= a || l.minute < b;
  let keyDate = l.date;
  if (active && a > b && l.minute < b) {
    const d = new Date(`${l.date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    keyDate = d.toISOString().slice(0, 10);
  }
  return { active, key: `${active ? "on" : "off"}:${keyDate}` };
}
