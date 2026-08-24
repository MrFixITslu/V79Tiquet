# V79Tiquet → FFPRO2 Gateway Integration (V79Tiquet side)

When a job is marked **Paid** — and only then — this sends its amount to
FFPRO2 as income under V79D — Vision79 Digital.

## Changed / new files

| File | What changed |
|---|---|
| `server/db.js` | Added `jobs.ffproSyncStatus`, `jobs.ffproEventId` columns + a partial index for the retry sweep |
| `server/gatewayClient.js` | **New.** Outbound client: builds the payload, sends it, retries with backoff, never throws |
| `server/index.js` | Hooked the trigger into `updateJobStage()` at the `'paid'` transition; added the periodic retry sweep |
| `src/App.tsx` | Threads `activeBusiness.id` through to `<Settings>` as `workspaceId` |
| `src/components/Settings.tsx` | Added an "Integrations" section showing the full Workspace ID with copy-to-clipboard |
| `env.example` | Documents `FFPRO_GATEWAY_URL` / `FFPRO_GATEWAY_SECRET` |

No `docker-compose.yml` change needed — it already uses `env_file: .env`, so anything you add to `.env` reaches the container automatically.

## PAID event implementation

**Trigger point:** `updateJobStage(id, 'paid', accountId, ...)` inside
`server/index.js`. This is the single, already-guarded place a job becomes
genuinely paid — manually setting `status: 'paid'` via the normal job-update
route was already blocked server-side before this change (`"Job status
cannot be manually moved to 'Paid'"`), and the only caller of
`updateJobStage(..., 'paid', ...)` in the whole codebase is
`POST /api/portal/:token/pay-final`. The hook lives inside `updateJobStage`
itself (not just that one route), so any future code path that calls it with
`'paid'` is automatically covered too.

**Does NOT fire on:** job creation, `in-progress`, `review`, `invoiced`, or
`completed`. Verified directly — pushed a real job through all four of
those statuses and confirmed `ffproSyncStatus` stayed `null` throughout.

**Durability:** the moment a job is marked paid, `ffproSyncStatus` is set to
`'pending'` in the same synchronous DB write — *before* any network call is
attempted. So even a process crash immediately after payment confirmation
still leaves a retryable record; nothing is silently lost.

## API endpoint (outbound)

```
POST {FFPRO_GATEWAY_URL}/api/gateway/webhooks/tiquet/paid
X-Gateway-Secret: {FFPRO_GATEWAY_SECRET}
Content-Type: application/json

{
  "eventId": "<uuid, generated once per job, reused on every retry>",
  "workspaceNumber": "<this account's own account_id>",
  "jobId": "<job.id>",
  "jobTitle": "<job.title>",
  "amount": <job.amount>,
  "currency": "<settings.currency, default USD>",
  "paidAt": "<ISO timestamp>",
  "paymentReference": "<job.id>",
  "customer": { "name": "<job.client>" }
}
```

## Authentication method

Shared secret in the `X-Gateway-Secret` header — the exact same pattern
already used by this app's own `website2026 → V79Tiquet` intake webhook
(`INTAKE_SECRET`, constant-time comparison). `workspaceNumber` is simply
this account's own `account_id` — there is nothing extra to configure on
this side for "which workspace"; every account already has one, shown in
Settings → Integrations for copying into FFPRO2.

## Retry behavior

1. On the paid transition: mark `ffproSyncStatus = 'pending'` synchronously, then attempt delivery.
2. Inline retries: up to 2 retries with backoff (2s, then 8s) within that same attempt.
3. If still failing after that: left as `'pending'`. A periodic sweep (`setInterval`, every 5 minutes — mirrors the existing `wsHeartbeat` pattern already in this file rather than adding new infrastructure) finds every job still `'pending'` and retries it.
4. A 4xx response (bad payload, bad secret, unknown/disabled workspace) is treated as **permanent** — logged once, not retried, since retrying an unfixable rejection forever is pointless. A 5xx or network error is treated as **transient** and left `'pending'` for the sweep.
5. **The Tiquet payment itself never fails or blocks on any of this** — `sendPaidEvent()` never throws, and `updateJobStage()` fires it without awaiting.

## Idempotency

Every retry of the same job reuses the exact same `ffproEventId` — generated
once, stored on the job row, never regenerated. FFPRO2 enforces uniqueness
on `(provider, workspace_number, jobId:eventId)` at the database level, so
however many times a delivery gets retried, at most one income transaction
is ever created. Verified directly: sent the same event twice and confirmed
FFPRO2 returned `alreadyProcessed: true` on the second one with no duplicate.

## Environment variables

```
FFPRO_GATEWAY_URL=https://your-ffpro2-domain.example.com
FFPRO_GATEWAY_SECRET=<same value as FFPRO2's TIQUET_GATEWAY_SECRET>
```

Both unset → the integration is simply inactive, no error, no retries
attempted. This is the expected state for any deployment that hasn't
configured it.

## Testing

Verified with a real, running instance of both apps — not just this app in
isolation:

1. Registered a real account, got its real `account_id`
2. Registered that ID as the Workspace Number in a real FFPRO2 instance
3. Created a real job, hit the real `pay-final` portal endpoint
4. Confirmed the income appeared in FFPRO2 automatically — correct amount, vendor, and business label — with no manual steps
5. Sent the same event twice → confirmed no duplicate
6. Pushed a second job through every non-paid status → confirmed `ffproSyncStatus` never left `null`
7. `npm test` (existing `tests/security.test.cjs` + `tests/e2e.test.cjs`, 23 tests) — all still passing after these changes
8. `npm run lint` (`tsc --noEmit`) and `npm run build` (`vite build`) — both clean

## Docker considerations

`server/gatewayClient.js` is picked up automatically by the existing
`COPY server/ ./server/` in the Dockerfile — no Dockerfile change needed.
`docker-compose.yml` already uses `env_file: .env` for this service, so the
two new env vars reach the container as soon as they're in `.env` — no
compose change needed either.
