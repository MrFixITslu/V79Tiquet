# V79Tiquet — Bug Audit & Fixes

Scope: full read-through of `server/*.js` (db, index, oauth, security, stripe,
gatewayClient), `src/api.ts`, `src/useSyncedCollection.ts`, `src/types.ts`,
`src/App.tsx`, plus `tsc --noEmit` and `vite build` as automated checks.
`src/components` (272K, ~80 files) was not individually read line-by-line —
see "Not yet reviewed" at the bottom.

Files changed: `server/db.js`, `server/index.js`, `server/oauth.js`,
`src/useSyncedCollection.ts`, `env.example`, `README.md`. Full unified diff
in `v79tiquet_bugfixes.patch`; this zip also contains the complete fixed
versions of those files, ready to drop into the repo.

Verified after fixing: `npx tsc --noEmit` clean, `npx vite build` succeeds,
`node --check` passes on all changed server files, server boots against the
`pg-mem` in-memory fallback and completes a register call successfully.

---

## Fixed

### 1. `db.transaction()` provided no actual atomicity (`server/db.js`)
The wrapper checked out a dedicated client and ran `BEGIN` / `COMMIT` /
`ROLLBACK` on it, but the callback you pass in calls the module-level
`db.prepare(...)`, which always runs through the shared connection pool — a
different connection per call, never the transaction's own client. So none
of a "transaction's" queries were ever part of the transaction. If the 2nd or
3rd statement failed, the 1st stayed committed; nothing rolled back.

Two call sites were affected:
- **Registration** (`POST /api/auth/register`): a failure inserting the user
  or settings row after the account row was created would leave an orphaned
  account with no user attached to it.
- **Job delete** (`DELETE /api/jobs/:id`): the four deletes (tags, activity
  logs, messages, job) were not atomic, *and* the call wasn't even `await`ed
  — see #2.

**Fix:** `db.transaction(fn)` now hands `fn` a client-bound `tx` object
(`tx.prepare/query/exec`, same shape as `db`) that runs every query on the
transaction's own connection. Both call sites updated to use `tx.prepare(...)`
instead of `db.prepare(...)` inside the callback.

### 2. Job delete: un-awaited transaction, errors bypassed the try/catch (`server/index.js`)
`db.transaction(async () => {...})()` was called without `await`. This meant:
- `res.json({ success: true })` could be sent before the deletes actually
  finished.
- Any error thrown inside was an **unhandled promise rejection** rather than
  being caught by the route's `try/catch` — it wouldn't surface as a 500, it
  would just crash silently (or crash the process, depending on Node's
  unhandled-rejection behavior).

**Fix:** now `await deleteJobTx()`, with the underlying atomicity fix from #1.

### 3. `POST /api/files` sent its response before uploads were saved (`server/index.js`)
The handler was a non-`async` function that did:
```js
const uploaded = (req.files || []).map(async f => { ...await db insert...; return record; });
res.status(201).json(uploaded);
```
`.map()` doesn't wait for async callbacks — `uploaded` was an array of
**pending Promises**, which serialize to `{}`. The client received an array
of empty objects instead of the actual file records, the DB insert and the
`fs.renameSync` might not have finished yet, and any error inside the map
was an unhandled rejection instead of a 500 response.

**Fix:** `await Promise.all(...)` around the mapped uploads, handler marked
`async`.

### 4. No server-side authorization checks anywhere — privilege escalation (`server/index.js`)
Grepped the whole file for role checks (`role !== `, `requireAdmin`, etc.) —
there were none. Every route only verified *who* the caller is
(`authenticateToken`), never *what* they're allowed to do. Concretely, any
authenticated user — regardless of their own role — could call:
- `POST /api/users` — invite a new teammate with any role, including Admin
- `PUT /api/users/:id` — change **any** user's role/permissions, including
  promoting themselves to Admin
- `DELETE /api/users/:id` — remove another user

The React UI hides these controls for non-Admins, but that's cosmetic —
nothing stopped a direct API call (curl, browser devtools, a modified
frontend build) from a non-Admin account.

**Fix:** added a `requireAdmin` middleware (`req.user.role === 'Admin'`) and
applied it to those three routes.

**Not fixed / worth a decision from you:** I deliberately did *not* extend
`requireAdmin` to every other mutating route (employees, payroll, clients,
industries, settings, templates) because I don't know your intended
permission model for the "Employee" role — it's plausible non-admins are
supposed to manage clients/jobs day-to-day. Worth reviewing `PagePermission`
in `src/types.ts` against what the backend actually enforces (currently:
nothing, anywhere, except the 3 routes above) and deciding which of the
remaining ~65 routes should be role-gated.

### 5. OAuth logins could sign tokens with a different (and guessable) secret than the rest of the app verifies against (`server/oauth.js`)
`server/index.js` resolves `JWT_SECRET` carefully: in production, if the env
var isn't set, it auto-generates a strong random secret and persists it to
disk so restarts don't invalidate sessions (`loadOrCreatePersistedSecret`).
`server/oauth.js` resolved its **own**, independent `JWT_SECRET`:
```js
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_v79_tickit';
```
This only matched `index.js`'s secret when `JWT_SECRET` was explicitly set
in the environment. If it was ever left unset in production:
- Tokens minted by Google/Apple/Facebook login would be signed with the
  hardcoded string `'dev_jwt_secret_v79_tickit'` — which is public, sitting
  in this open-source repo — while `authenticateToken` verifies against the
  real persisted secret. OAuth logins would fail immediately.
- More seriously, anyone could **forge a valid session token** for any
  account using that well-known default string, since it's the actual
  secret being used to sign real tokens in that misconfiguration.

**Fix:** `registerOAuthRoutes(app, JWT_SECRET)` — the secret is now resolved
once in `index.js` and passed in, so OAuth-issued tokens always use the same
secret `authenticateToken` checks against. `oauth.js` no longer reads
`JWT_SECRET` itself.

### 6. Race condition in the client-side save/sync hook (`src/useSyncedCollection.ts`)
`useSyncedCollection` (used by most of the app's "edit this list" flows) had
a `syncingRef` that was clearly meant to prevent two syncs to the same
endpoint from running concurrently — it was declared, threaded through as a
parameter — and never actually read or written anywhere. So two `setItems`
calls close together (two quick edits, or a second save firing while the
first request is still in flight) ran `syncDiff` concurrently. Each computed
its diff against a `prev` snapshot that could already be stale by the time
its requests landed — capable of double-firing a `create` for the same new
row, or letting an `update` and a `delete` for the same id land out of
order.

**Fix:** replaced the inert boolean ref with a promise chain
(`syncChainRef`) — each sync now runs after the previous one to the same
endpoint has fully settled, so they're strictly sequential.

---

### 7. Stale `tiquet.v79sl.duckdns.org` references left over from the domain move to `tiquet.v79sl.com`
The app-level CORS allowlist and the OAuth config endpoint (`server/index.js`, `server/oauth.js`) were already updated to the new domain — good. Three places weren't:
- `server/index.js` — `COMPANY_WEBSITE_URL` (the fallback link used in the welcome email's `{{site_url}}` when a client record has no `website` set) still defaulted to `https://v79sl.duckdns.org` — the *old* address for the main Vision79 Digital site, not even the Tiquet subdomain. Updated to `https://v79sl.com`, matching the main site's own completed migration.
- `env.example` — `APP_BASE_URL` and `ALLOWED_ORIGINS` still showed the old `tiquet.v79sl.duckdns.org`, so a fresh deploy following the example file would start on the wrong domain. Updated to `tiquet.v79sl.com`.
- `README.md` — the Nginx Proxy Manager setup instructions still named the old proxy host. Updated to `tiquet.v79sl.com`.

---

## Not yet reviewed
- `src/components/**` (~80 files, 272K) — not read individually. If you
  want, I can do a follow-up pass focused there (UI state bugs, stale
  closures, missing loading/error states) — just say the word.
- `server/email.js` (380 lines) — skimmed structurally, not fully audited.
- Rate limiting on `/api/portal/:token/*` — these are unauthenticated,
  token-gated endpoints with no rate limiter. Given `secureToken` is a
  cryptographically random 32-byte hex value (infeasible to brute-force),
  this is low risk, but you may still want a limiter there as
  defense-in-depth against a token leaking partially or being logged
  somewhere.
- Broader RBAC (see item 4's "not fixed" note).
