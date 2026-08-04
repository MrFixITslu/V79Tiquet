# V79 TIQUET — Merged Production Build

This merges the **V79Tiquet** frontend (the newer, nicer UI — Payroll, Clients,
Invoices, File Repository, User Management) onto the **Tiquet-Final** backend
(real auth, TOTP 2FA, multi-tenant accounts, audit logging), since V79Tiquet
by itself had no backend at all — every "feature" was simulated in the
browser with `localStorage`.

## What changed from V79Tiquet
- **Real auth**: email + password (bcrypt), JWT sessions, account lockout
  after repeated failed logins, audit log of every auth event.
- **Real 2FA**: TOTP (Google Authenticator / Authy compatible), enabled per
  user from Settings after first login — no SMS cost/deliverability
  dependency.
- **Real data**: everything (jobs, clients, employees, payroll, files,
  teammates) is stored in SQLite on the server and scoped per account
  (workspace), not `localStorage`.
- **Real file storage**: uploads are stored on disk and streamed back on
  download — the old "Mock content for {file.name}" fake download is gone.
- **No demo/seed data in production**: `SEED_DEMO_DATA` defaults to `false`;
  a fresh deploy starts with zero jobs/clients/employees, not fabricated
  "Acme Corp" placeholders.
- **Docker/port config kept from V79Tiquet**: container name
  `v79-tiquet-manager`, port `8080`, same `proxy_network` convention as your
  other V79 apps. The Dockerfile itself had to change from static-nginx to
  Node, since a static file server can't run an API — that's the one
  structural change that was unavoidable to add real login/data.

## What's still simulated / needs a follow-up pass
- **Billing (`server/stripe.js`)**: this is *not* wired into the V79Tiquet UI
  at all, and is still simulated. It's now disabled by default in production
  (returns nothing unless `STRIPE_SECRET_KEY` is set) so there's no live fake
  checkout endpoint sitting on the API. Wiring real Stripe is a separate task.
- **PII encryption at rest**: client/employee PII is currently stored in
  plaintext columns, matching Tiquet-Final's existing pattern, not the
  AES-256-GCM pattern used in SIWM/VISION79. Worth a follow-up pass if this
  will hold sensitive client data long-term.
- **Data export/delete self-service**: no in-app "export my data" /
  "delete my account" flow yet (relevant if you want a GDPR/CCPA-style
  data-subject-rights story — Saint Lucia doesn't have an equivalent law
  today, but several of your clients may be under one).

## Setup
1. Copy `env.example` to `.env` and fill in `JWT_SECRET`,
   `SUPER_ADMIN_JWT_SECRET`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, and
   SMTP credentials (needed for teammate invite emails). Generate secrets
   with `npm run generate-secrets` or the `node -e "..."` one-liners in the
   file's comments.
   - Note: if you skip this, the app **won't crash anymore** -- see "About
     the 502 error" below. But an explicit `.env` is still what you want for
     a reproducible deploy.
2. `docker compose up -d --build`
3. In Nginx Proxy Manager's UI, add/edit the Proxy Host for
   `tiquet.v79sl.duckdns.org`:
   - **Forward Hostname / IP**: `v79-tiquet-manager`
   - **Forward Port**: `8080`
   - **Websockets Support**: **ON** -- the app uses a WebSocket connection
     (`/ws`) for real-time job messages/notifications; without this toggle
     those features will silently fail even though the rest of the app works.
   - NPM and this container must be on the same Docker network. Verify with
     `docker network ls` -- the compose file assumes it's called
     `proxy_network`; if NPM's own compose file defines it under a different
     name, update `docker-compose.yml` here to match.
4. Visit the app -- since there's no seed data, the first thing you'll do is
   register a workspace (this creates the first Admin account for that
   account/business).
5. Turn on 2FA per-user from Settings once logged in.

## About the 502 error
Two real bugs caused this, both fixed now:
1. **The container was crashing on boot.** In production mode, the server
   used to hard-`process.exit(1)` if `JWT_SECRET`/`SUPER_ADMIN_JWT_SECRET`
   weren't set in `.env`. A crashed container has nothing listening on
   port 8080, so NPM's proxy request has no upstream to reach -> 502, forever
   -- with `docker compose up -d` looking like it "worked" since
   `restart: unless-stopped` just kept relaunching it into the same crash.
   Now it self-heals: if a secret isn't provided, it generates a strong
   random one on first boot and persists it in the same Docker volume as the
   database, so it survives restarts. You'll see a `[WARN]` in
   `docker logs v79-tiquet-manager` if this happens -- that's your cue to add
   the value to `.env` for a fully reproducible deploy.
2. **`ports:` was publishing directly to the host.** This wasn't the actual
   502 cause but was worth removing: with NPM reaching this container over
   the internal `proxy_network` by container name, there's no reason to also
   bind a host port -- doing so just adds an unneeded, un-proxied direct path
   into the app and risks colliding with whatever else is running on that
   host port. Removed; add it back temporarily only if you need to
   `curl localhost:8080` directly on the server for debugging.

If you ever see a 502 again, `docker logs v79-tiquet-manager` is the first
place to look -- the health endpoint (`/health`) and startup log tell you
immediately whether the process is even alive.

## Local dev (outside Docker)
```
npm install
cp env.example .env   # fill in JWT_SECRET etc.
npm run dev            # runs Express on :3001 and Vite on :3000 with a proxy
```
