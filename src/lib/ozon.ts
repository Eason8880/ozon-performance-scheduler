const base = "https://api-performance.ozon.ru";
async function getToken(clientId: string, clientSecret: string) {
  const r = await fetch(`${base}/api/client/token`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!r.ok) throw new Error(`Ozon authorization failed (${r.status})`);
  const j = await r.json();
  if (!j.access_token)
    throw new Error("Ozon authorization returned no access token");
  return j.access_token as string;
}
export async function checkCredentials(id: string, secret: string) {
  await getToken(id, secret);
}
export async function setPromotion(
  clientId: string,
  clientSecret: string,
  active: boolean,
) {
  const token = await getToken(clientId, clientSecret);
  const path = active ? "activate" : "deactivate";
  const r = await fetch(`${base}/api/client/campaign/all_sku_promo/${path}`, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!r.ok) {
    throw new Error(`Ozon ${path} request failed (${r.status})`);
  }
  return r.status === 204 ? null : await r.json().catch(() => null);
}
