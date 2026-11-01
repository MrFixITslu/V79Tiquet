import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Isolated customer auth primitives. This is not wired to live HTTP routes.
// Business identity MUST come from trusted server-side routing, never req.body.
export const CUSTOMER_AUTH_LIMITS = Object.freeze({
  verificationTtlMs: 15 * 60 * 1000,
  sessionTtlMs: 12 * 60 * 60 * 1000,
  maxEmailLength: 254,
  maxNameLength: 120,
});

function requiredServerId(value, field) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{4,128}$/.test(value)) {
    throw new TypeError("Invalid server-provided " + field);
  }
  return value;
}

function validTime(now) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError("Invalid current time");
  }
  return now;
}

export function normalizeCustomerEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > CUSTOMER_AUTH_LIMITS.maxEmailLength || email.length < 6 ||
      /[\u0000-\u001f\u007f]/.test(email)) return null;
  const [local, domain, extra] = email.split("@");
  if (extra !== undefined || !local || local.length > 64 || !domain ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain) ||
      domain.split(".").some(label => label.startsWith("-") || label.endsWith("-"))) {
    return null;
  }
  return email;
}

export function normalizeCustomerName(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f<>]/.test(value)) return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > CUSTOMER_AUTH_LIMITS.maxNameLength) return null;
  return name;
}

function tokenFingerprint(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return createHash("sha256").update(token, "utf8").digest();
}

function safeHashMatch(token, digestHex) {
  const candidate = tokenFingerprint(token);
  if (!candidate || typeof digestHex !== "string" || !/^[a-f0-9]{64}$/.test(digestHex)) return false;
  return timingSafeEqual(candidate, Buffer.from(digestHex, "hex"));
}

export function issueCustomerVerification({ accountId, email, now = Date.now() }) {
  const trustedAccountId = requiredServerId(accountId, "accountId");
  const normalizedEmail = normalizeCustomerEmail(email);
  validTime(now);
  if (!normalizedEmail) throw new TypeError("Invalid email");
  const token = randomBytes(32).toString("base64url");
  const record = {
    accountId: trustedAccountId,
    email: normalizedEmail,
    tokenHash: tokenFingerprint(token).toString("hex"),
    issuedAt: now,
    expiresAt: now + CUSTOMER_AUTH_LIMITS.verificationTtlMs,
    usedAt: null,
  };
  return { token, record };
}

// Caller must atomically mark the matching record used before issuing a session.
// This check is not itself a DB transaction or a substitute for one.
export function verifyCustomerChallenge({ token, record, accountId, now = Date.now() }) {
  const trustedAccountId = requiredServerId(accountId, "accountId");
  validTime(now);
  return Boolean(record && record.accountId === trustedAccountId &&
    normalizeCustomerEmail(record.email) === record.email &&
    record.usedAt === null && Number.isSafeInteger(record.expiresAt) &&
    Number.isSafeInteger(record.issuedAt) && now >= record.issuedAt &&
    now < record.expiresAt && safeHashMatch(token, record.tokenHash));
}

export function issueCustomerSession({ accountId, customerId, emailVerifiedAt, now = Date.now() }) {
  const trustedAccountId = requiredServerId(accountId, "accountId");
  const trustedCustomerId = requiredServerId(customerId, "customerId");
  validTime(now);
  if (!Number.isSafeInteger(emailVerifiedAt) || emailVerifiedAt > now || emailVerifiedAt < 0) {
    throw new TypeError("Verified email required before session creation");
  }
  const token = randomBytes(32).toString("base64url");
  const record = {
    accountId: trustedAccountId,
    customerId: trustedCustomerId,
    tokenHash: tokenFingerprint(token).toString("hex"),
    issuedAt: now,
    expiresAt: now + CUSTOMER_AUTH_LIMITS.sessionTtlMs,
    revokedAt: null,
  };
  return { token, record };
}

export function customerSessionCookie(token) {
  if (!tokenFingerprint(token)) throw new TypeError("Invalid session token");
  return "__Host-tiquet_customer=" + token +
    "; Path=/; Max-Age=" + Math.floor(CUSTOMER_AUTH_LIMITS.sessionTtlMs / 1000) +
    "; HttpOnly; Secure; SameSite=Lax";
}

export function authorizeCustomerSession({ token, record, accountId, now = Date.now() }) {
  const trustedAccountId = requiredServerId(accountId, "accountId");
  validTime(now);
  if (!record || record.accountId !== trustedAccountId || record.revokedAt !== null ||
      !Number.isSafeInteger(record.issuedAt) || now < record.issuedAt ||
      !Number.isSafeInteger(record.expiresAt) || now >= record.expiresAt ||
      !record.customerId || !safeHashMatch(token, record.tokenHash)) return null;
  return Object.freeze({ accountId: trustedAccountId, customerId: record.customerId });
}

export function customerOwnsTicket({ session, ticket }) {
  return Boolean(session && ticket &&
    typeof session.accountId === "string" && typeof session.customerId === "string" &&
    session.accountId === ticket.account_id &&
    session.customerId === ticket.clientId);
}

// The API must return a generic acknowledgement regardless of account existence.
export const GENERIC_VERIFICATION_RESPONSE =
  "If this address is eligible, we will send a verification link.";
