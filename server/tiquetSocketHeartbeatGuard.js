/**
 * P1: bound a hanging database/Hub authorization request for an existing
 * Tiquet staff or customer-portal WebSocket. A connection must not keep its
 * private job-room subscription forever while one Promise never resolves.
 *
 * Pure, read-only predicate. The caller immediately unsubscribes and
 * terminates the socket on true. This never approves socket access.
 */
export const MAX_SOCKET_REVALIDATION_MS = 30_000;

export function isStalledSocketRevalidation(socket, now = Date.now()) {
  if (!socket?.entitlementCheckInFlight) return false;
  const started = socket.entitlementCheckStartedAt;
  return !Number.isFinite(now) || !Number.isFinite(started) ||
    started > now + 1000 ||
    now - started >= MAX_SOCKET_REVALIDATION_MS;
}
