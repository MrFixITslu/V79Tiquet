import { createHash, createHmac } from "node:crypto";

// Feature-gated, uncached, signed Hub session-lineage check.
// Deny on missing Hub, timeout, malformed response or expired/revoked session.
// The Hub-session reference is a SHA-256 lookup key, never a bearer credential.
export function createHubSessionStatusChecker({ hubUrl, secret, now = Date.now, transport = fetch }) {
  if (!/^https?:\/\//.test(hubUrl || "") || typeof secret !== "string" || secret.length < 32) {
    throw new Error("Hub session status validation is not securely configured");
  }
  const url = new URL("/api/platform/session/status", hubUrl);
  const pathname = url.pathname;
  return async ({ hubSessionId, organizationId, scopedUserId }) => {
    if (!/^[a-f0-9]{64}$/.test(String(hubSessionId || "")) ||
        typeof organizationId !== "string" || organizationId.length < 5 ||
        typeof scopedUserId !== "string" || scopedUserId.length < 5) return false;
    const body = JSON.stringify({ product:"tiquet", hubSessionId, organizationId, scopedUserId });
    const timestamp = String(now());
    const contentHash = createHash("sha256").update(body).digest("hex");
    const canonical = ["POST", pathname, timestamp, contentHash].join("\n");
    const signature = createHmac("sha256", secret).update(canonical).digest("hex");
    try {
      const response = await transport(url, {
        method:"POST", body,
        headers: {
          "content-type":"application/json",
          "x-v79-service-id":"v79-tiquet",
          "x-v79-timestamp":timestamp,
          "x-v79-signature":signature,
        },
        signal:AbortSignal.timeout(3500),
      });
      if (!response.ok) return false;
      const result = await response.json();
      return result?.active === true;
    } catch {
      return false;
    }
  };
}
