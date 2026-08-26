# V79 Website → V79Tiquet Lead Capture Integration (V79Tiquet side)

When a visitor submits the Contact Us form on the V79 website, they're
automatically created as a Client in Client Management here — clearly
marked as a website lead, with their original message preserved.

## Important: most of this endpoint already existed

`POST /api/public/intake` was built in an earlier session for this exact
purpose (shared-secret auth, rate limiting, field validation — all already
solid). This change **upgrades its behavior**, it doesn't replace it:

| File | What changed |
|---|---|
| `server/db.js` | Added `clients.leadSource`, `clients.leadStatus`, `jobs.intakeEventId` (+ unique index) |
| `server/index.js` | Rewrote the client-matching logic in `/api/public/intake` (see below); everything else about the route — auth, rate limiting, job creation — is unchanged |
| `src/types.ts` | Added `leadSource`/`leadStatus`/`notes` to the `Client` interface |
| `src/components/Clients.tsx` | Added a "Website Lead" badge (list + detail view) and a Notes section — **`notes` was previously never rendered anywhere in the UI**, so the preserved inquiry would have been invisible without querying the database directly |

## What actually changed in the endpoint's behavior

**Before:** matched an existing client by exact **name** string. Two
different people sharing a name would collide; the same person spelling
theirs differently (or via autofill) would create a duplicate. No lead
marking on the client at all — only the associated job got a "Website
Lead" tag. The original message went into the job's description only,
never onto the client record. A network retry created a second job.

**Now:**
- Matches an existing client by **email** (case-insensitive) first, then
  **phone** as a fallback — per the task's requirement, not by name.
- **New person** → client created with `leadSource: 'website'`,
  `leadStatus: 'New'`, and `notes` seeded with the original inquiry.
- **Existing client** (by email/phone) → the existing record is preserved
  as-is; the new inquiry is **appended** to `notes` with a timestamp,
  keeping full history. `leadSource`/`leadStatus` are deliberately **not**
  touched on an update — retroactively relabeling an established client as
  a fresh "website lead" would misrepresent how they actually came in, and
  overwriting a status staff already changed (e.g. after converting them)
  would lose real work.
- **Idempotent retries**: the caller can send the same `eventId` on a retry
  after a network failure. A duplicate `eventId` returns the original
  result (`action: "already_processed"`) instead of creating a second job.
  Enforced by a `UNIQUE` index on `jobs.intakeEventId`, not just application
  logic.
- Response now includes `action` (`"created"` / `"updated"` /
  `"already_processed"`) and `clientId`, in addition to the existing
  `success`/`jobId` fields — purely additive, nothing removed.

## No new environment variables

Reuses the existing `INTAKE_SECRET` / `INTAKE_ACCOUNT_ID` — no Docker or
`.env` changes needed on this side.

## Database migration

Automatic, same `CREATE TABLE IF NOT EXISTS` / `safeAddColumn` pattern
already used throughout `server/db.js`. Just deploy and restart.

## API endpoint (unchanged path/auth, upgraded behavior)

```
POST /api/public/intake
X-Intake-Secret: <INTAKE_SECRET>
Content-Type: application/json

{
  "eventId": "uuid, generated once per submission, reused on retry",
  "name": "...", "company": "...", "email": "...", "phone": "...",
  "employees": "optional", "biggestChallenge": "optional",
  "message": "optional — preserved verbatim in the client's notes",
  "source": "optional, defaults to 'website2026'"
}
```

Responses: `201` new job+client, `200 { action: "already_processed" }` for
a duplicate `eventId`, `400` validation failure, `401` bad/missing secret.

## Post-delivery self-audit — bug found and fixed

After the initial delivery, a dedicated re-audit of this code specifically
(prompted by a request to check the work rather than assume it was correct)
found one real bug: the **idempotent-duplicate-return branch** (when a
retry arrives with an `eventId` that's already been processed) was still
looking up the client by the old **name**-based match, even though the
*creation* path had already been correctly upgraded to email/phone
matching. This meant a retried submission could return the wrong
`clientId` — or `null` — if two clients shared a name, or if staff had
renamed the client since it was created.

**Fixed** to use the same email-then-phone lookup as the creation path.
**Verified directly**: created a client, renamed it via direct DB access
(reproducing exactly the scenario that broke the old code), then retried
the same `eventId` — confirmed the correct `clientId` now comes back
regardless of the rename.

## Critical: INTAKE_ACCOUNT_ID must be the FULL Workspace ID, not the header's truncated display

The app header shows `Workspace: {id.slice(0, 8)}` — an 8-character
**truncated** prefix of the real `account_id` (e.g. `4864426e`), separate
from the full copyable ID in Settings → Integrations. Setting
`INTAKE_ACCOUNT_ID` to the truncated value would not match any real
account.

**This is now a hard-rejected condition, not a silent one.** Before this
fix, that misconfiguration would have caused every website lead to be
created under a phantom `account_id` that no logged-in user could ever
see — the request would still return `200`/`201`, so nothing would look
broken; the leads would simply vanish with no error anywhere. Now:

- **At boot**: if `INTAKE_SECRET` is configured but `INTAKE_ACCOUNT_ID`
  doesn't match a real row in `accounts`, a clear error is logged
  immediately on startup — don't wait for a real lead to discover this.
- **Per request**: the same check runs before any data is touched; a
  mismatch returns `503` and creates nothing.

**Verified directly**, using the exact truncated value from this
requirement: booted with `INTAKE_ACCOUNT_ID=4864426e` → confirmed the
startup warning fires and a real submission is rejected with `503` and
creates zero rows. Fixed the value to a real account → confirmed the
startup warning disappears and submissions succeed. Also verified the
**recovery path**: a lead submitted while misconfigured is safely queued
`pending` on the website2026 side (not lost, not falsely marked delivered)
and is automatically delivered — with no re-submission needed — the moment
the accountId is corrected, since `503` isn't in the "permanent failure"
range website2026's retry logic treats as unfixable.

**To get the correct value**: open V79Tiquet → Settings → Integrations and
copy the full Workspace ID shown there (not the header).

## Testing

Verified against a real running instance, not just reviewed:

1. **New lead** → confirmed `leadSource: "website"`, `leadStatus: "New"`, and the exact inquiry text in `notes`
2. **Same email, different `eventId`** → confirmed same `clientId` returned, client count stayed at 1, both inquiries present in `notes` history
3. **Exact retry of a previous `eventId`** → confirmed `action: "already_processed"`, job count did not increase
4. Wrong secret → 401; missing required field → 400; invalid email → 400
5. Existing test suite (`npm test`, 23 tests) — all still passing

## Docker considerations

None — no Dockerfile or `docker-compose.yml` changes needed on this side.
