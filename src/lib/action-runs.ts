export const ACTION_RUN_PAGE_SIZE = 5;

export type ActionRunCursor = { createdAt: string; id: string };

export type ActionRunRow = {
  id: string;
  created_at: string;
  action_key: string;
  action: string;
  status: string;
  detail: string | null;
  source: string;
};

export function canReadStoreLogs(group: string, ownerGroup: string | null) {
  return group === "admin" || group === ownerGroup;
}

export function encodeActionRunCursor(cursor: ActionRunCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeActionRunCursor(value: string): ActionRunCursor | null {
  try {
    if (!value || value.length > 512) return null;
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (!parsed || typeof parsed !== "object") return null;
    const cursor = parsed as Record<string, unknown>;
    if (
      typeof cursor.createdAt !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(cursor.createdAt) ||
      typeof cursor.id !== "string" ||
      !/^[1-9]\d*$/.test(cursor.id)
    )
      return null;
    const [year, month, day, hour, minute, second] = cursor.createdAt
      .replace("T", "-")
      .replace("Z", "")
      .split(/[\-. :]/)
      .map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() + 1 !== month ||
      date.getUTCDate() !== day ||
      hour > 23 ||
      minute > 59 ||
      second > 59 ||
      cursor.id.length > 19 ||
      (cursor.id.length === 19 && cursor.id > "9223372036854775807")
    )
      return null;
    return { createdAt: cursor.createdAt, id: cursor.id };
  } catch {
    return null;
  }
}

export function pageActionRuns(rows: ActionRunRow[]) {
  const items = rows.slice(0, ACTION_RUN_PAGE_SIZE);
  const last = items.at(-1);
  return {
    items,
    hasMore: rows.length > ACTION_RUN_PAGE_SIZE,
    nextCursor: last
      ? encodeActionRunCursor({ createdAt: last.created_at, id: last.id })
      : null,
  };
}
