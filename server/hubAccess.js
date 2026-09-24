import crypto from "node:crypto";

const MAX_SKEW_MS = 5 * 60 * 1000;

function clean(value) {
  return typeof value === "string" ? value.trim().replace(/^['"]|['"]$/g, "") : "";
}

function bodyHash(body) {
  return crypto.createHash("sha256").update(body || "").digest("hex");
}

function sign({ method, pathname, timestamp, body, secret }) {
  const canonical = [String(method).toUpperCase(), pathname, String(timestamp), bodyHash(body)].join("\n");
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

export function hubPublicUrl() {
  return clean(process.env.V79_HUB_PUBLIC_URL) || "https://hub.v79sl.com";
}

export async function consumeHubLaunchTicket(ticket) {
  const baseUrl = clean(process.env.V79_HUB_INTERNAL_URL);
  const secret = clean(process.env.V79_TIQUET_LAUNCH_SECRET);
  if (!baseUrl) throw new Error("V79_HUB_INTERNAL_URL is not configured.");
  if (secret.length < 32) throw new Error("V79_TIQUET_LAUNCH_SECRET must be at least 32 characters.");

  const pathname = "/api/platform/session/consume";
  const body = JSON.stringify({ ticket, product: "tiquet" });
  const timestamp = String(Date.now());
  const signature = sign({ method:"POST", pathname, timestamp, body, secret });

  const response = await fetch(new URL(pathname, baseUrl), {
    method:"POST",
    headers:{
      "content-type":"application/json",
      "x-v79-service-id":"v79-tiquet",
      "x-v79-timestamp":timestamp,
      "x-v79-signature":signature,
    },
    body,
    signal:AbortSignal.timeout(5000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `V79 Hub returned HTTP ${response.status}`);
  if (payload?.entitlement?.product !== "tiquet" || !payload?.entitlement?.enabled) {
    throw new Error("V79 Tiquet entitlement was not granted.");
  }
  return payload;
}
