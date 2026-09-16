# V79Tiquet — Bug Audit & Fixes

Scope: full read-through of `server/*.js` (db, index, oauth, security, stripe,
gatewayClient), `src/api.ts`, `src/useSyncedCollection.ts`, `src/types.ts`,
`src/App.tsx`, plus `tsc --noEmit` and `vite build` as automated checks.
`src/components` (272K, ~80 files) was not individually read line-by-line —
see "Not yet reviewed" at the bottom.

Files changed: `server/db.js`, `server/index.js`, `server/oauth.js`,
`src/useSyncedCollection.ts`, `env.example`, `README.md`,
`scripts/migrate-sqlite-to-pg.js`. Full unified diff in
`v79tiquet_bugfixes.patch`; this zip also contains the complete fixed
versions of those files, ready to drop into the repo.

Verified after fixing: `npx tsc --noEmit` clean, `npx vite build` succeeds,
`node --check` passes on all changed server files. Beyond static checks, this
was also verified live: booted the server against the `pg-mem` in-memory
fallback and exercised every fix end-to-end (registration, admin-gated
invite/edit/delete on both the allow and deny path, file upload, job
deletion, forgot-password) via curl, plus a full reproduction of the
migration bug against a purpose-built SQLite fixture, plus an isolated
simulation of the frontend race-condition fix. This live pass caught two
real bugs in the *fixes themselves* (see items 11 and 12) that a re-read of
the code alone had missed — both are fixed and reverified below.

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

### 8. SQLite→Postgres migration permanently stuck on a duplicate-key error (`scripts/migrate-sqlite-to-pg.js`)
This is what's actually happening in your `tiquet-manager` logs right now — the
migration is failing on every single restart, which means the real account's
jobs/clients/employees/settings are **still sitting in SQLite and never
making it into Postgres**.

Root cause: `email_templates` has two separate constraints — the `id`
primary key, and a unique index on `(account_id, type)`
(`idx_templates_account_type`, one welcome + one newsletter template per
account). The migration script's generic conflict handling only targets the
`id` column (`ON CONFLICT (id) DO NOTHING`), which does nothing to prevent
an `(account_id, type)` collision — Postgres still throws a hard error for
that, aborting the *entire* transaction (every table in this run, not just
email templates).

That collision is real, and it's self-inflicted by a different part of
`initDb()`: on every startup, after a migration attempt, `initDb()`
unconditionally seeds a placeholder welcome/newsletter template for every
account that currently exists in Postgres (`default_account` included). So
the sequence is: migration fails for some other/original reason → rolls
back → but the *seed* step still runs right after and creates a
`(default_account, welcome)` placeholder row → next restart, migration
tries again, and now collides with that placeholder → fails again → same
seed step recreates the trap → repeat forever. (Your SQLite data's real
tenant account appears to actually be `default_account` itself, from
before this app had proper multi-tenancy — that's why the collision is on
exactly that id.)

**Fix:** for `email_templates` specifically, the insert now targets the
actual unique constraint — `ON CONFLICT (account_id, type) DO UPDATE SET
subject/body/htmlbody/updatedat = EXCLUDED...` — so the real migrated
content overwrites the placeholder instead of erroring. This is
self-healing: once this fix is deployed, the very next restart's migration
attempt will succeed and overwrite the placeholder rows with your real
templates — no manual DB surgery needed.

**This is very likely also the cause of your `INTAKE_ACCOUNT_ID` startup
warning** — `4864426e-841d-4536-a0fb-8103d504d746` "doesn't match any real
account" because that account has been stuck in SQLite, never migrated into
Postgres, this whole time. Once the migration fix above runs successfully,
check whether that warning clears on its own before changing the
`INTAKE_ACCOUNT_ID` env var.

### 9. "Forgot password" silently did nothing for Google/Apple/Facebook sign-in accounts (`server/index.js`)
`POST /api/auth/forgot-password` only sent a reset email when
`user.password_hash` was already set — accounts created via "Continue with
Google" (or Apple/Facebook) never get a `password_hash` at all (see
`findOrCreateOAuthUser` in `server/oauth.js`), so for those accounts the
route always took the silent no-op branch. The response is deliberately the
same generic "if an account exists, a reset link has been sent" message
either way (to prevent email enumeration), so there was **no visible error
anywhere** — it just quietly never sent anything, every time.

Combined with the Google sign-in issue below, this can mean a full lockout:
Google login broken + the account has no password + password reset
silently refuses to help.

**Fix:** removed the `password_hash` requirement — completing the emailed
reset link is just as strong a proof of account ownership as a normal
password reset, so it's now allowed to *establish* a password for an
OAuth-only account, not just reset an existing one. `/api/auth/login`
already handles this correctly once a `password_hash` exists, so no changes
were needed there.

**If email still doesn't arrive after this fix**, that's a separate,
infrastructure-side possibility worth ruling out: `server/email.js` silently
no-ops (logs only, doesn't error) whenever `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`
aren't all set in the `tiquet-manager` container's environment. Check that
container's logs for `SMTP not configured — emails will be logged but not
delivered` or `SMTP connection verification failed` around a reset attempt.

### 10. Google sign-in hangs on a blank `accounts.google.com/gsi/transform` page — diagnosed, not a code bug
I read through `src/components/GoogleAuthButton.tsx` and `server/oauth.js` —
the implementation is a standard, correctly-wired use of `@react-oauth/google`
(current version, `0.12.2`) with a normal ID-token flow (no custom/broken
logic to fix). A blank hang on that specific Google URL, rather than a clear
error, is the classic symptom of one of two things **outside this repo's
code**:

1. **Google Cloud Console's "Authorized JavaScript origins" for this OAuth
   client still lists the old domain** (`tiquet.v79sl.duckdns.org`) and
   hasn't been updated to `https://tiquet.v79sl.com` since the domain move —
   worth checking first, since this lines up with the recent migration.
2. **Third-party cookies blocked** in that browser/profile — Chrome now
   blocks these by default in a growing number of contexts, and Google's
   relay iframe depends on them when it can't fall back to FedCM.

Nothing to patch in the app for this one — worth checking (1) in Google
Cloud Console, then testing in a plain browser profile with third-party
cookies allowed to rule out (2).

---

---

### 11. Fixed a bug in my own fix: `requireAdmin` rejected everyone, including real Admins
Testing item 4's middleware end-to-end (not just reading it back) turned up
a real problem: the JWT issued at login/register only ever carries
`{id, email, account_id}` — it never included a `role` claim, at any sign-in
path (register, login, 2FA, OAuth). My first version of `requireAdmin`
checked `req.user.role`, which is *always* `undefined` — so it rejected
**every single request, including legitimate Admins**, not just the
privilege-escalation attempts it was meant to stop.

**Fix:** `requireAdmin` now looks the caller's current role up from the DB
by `req.user.id` instead of trusting a token claim. This is also more
correct than embedding `role` in the JWT would have been: a demoted Admin
loses access immediately, rather than keeping it for the rest of their
token's lifetime (up to 8h, or 1d after 2FA) — it mirrors the same
"check current DB state, don't trust the token" pattern `authenticateToken`
already uses for account suspension.

**Retested after the fix:** a real Admin's invite/edit/delete calls succeed
(201/200); a minted Employee-role token is correctly rejected (403) on all
three routes; `GET /api/users` (not admin-gated) still works for both roles.

### 12. Found via testing, not review: `initDb()` silently discarded the real account's name during migration
Building an exact reproduction of the migration bug (a fixture SQLite file
with real data under `account_id = 'default_account'`, matching your setup)
proved the item 8 fix works — but also exposed a second, related bug:
`initDb()` unconditionally inserts a `('default_account', 'Default
Account', …)` placeholder row into `accounts` *before* it ever attempts
migration. Since your real account apparently already uses that literal id,
the placeholder claims the `id` first, and migration's own account insert
(`ON CONFLICT (id) DO NOTHING`) then silently no-ops — so even with the
email-template crash fixed, your account's real name would have stayed
stuck as "Default Account" forever, with no error anywhere to show it.

**Fix:** reordered `initDb()` to attempt migration *before* inserting the
placeholder account row. The placeholder insert is now purely a fallback for
a genuinely fresh install with nothing to migrate — nothing about migration
itself depends on that row existing first, since `accounts` is the very
first table migration populates, ahead of anything that references
`account_id`.

**Verified with a full reproduction, not just re-reading the code:** built a
throwaway SQLite fixture with a real `default_account` row (name "Fire Lion
Real Account") plus a colliding `email_templates` row, pointed a fresh
`initDb()` at it via `DATABASE_PATH`, and confirmed: migration now completes
with no error, the real email template content overwrites the placeholder
(item 8), and — after this additional fix — the account's real name comes
through correctly instead of staying "Default Account" (item 12).

### 13. Hardened the sync-chain fix (item 6) against a hypothetical future failure
`syncDiff` already catches every request it makes internally and never
throws, so the chain from item 6 couldn't actually get stuck under current
behavior — but chaining with a bare `.then(fn)` (no rejection handler) means
*if that ever changed*, a single unexpected throw would permanently wedge
every later sync to that endpoint (`.then(onFulfilled)` on a rejected
promise never calls `onFulfilled` again). Added a `.catch()` so one bad sync
can't take down every sync after it, regardless of what `syncDiff` does in
the future. Verified with an isolated simulation of the exact chaining
pattern (4 rapid calls with staggered delays, one forced to throw) — confirmed
strictly sequential execution with no concurrent overlap, and that the
simulated failure didn't stop the next call from running.

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
