# Phase 9 REDTEAM — guarded release candidate readiness
Date: 2026-10-24. Branch: feature/support-desk-phase1-20261024.
Authority: synthetic-source engineering, no merges, deployments, live data, real providers or outgoing messages.

## Three approaches
1. Source checklist only — REJECT: fails to exercise build and restore.
2. Live Docker host/production database parity probes — REJECT: unauthorized, risk of runtime drift.
3. SELECT: immutable Hub source + isolated branch build, disposable Compose rendering, synthetic multi-store recovery, configuration and image contract tests, no registry pushes and no live connections.

## Threat model and decisions
- Supply chain: Hub pins Node 22; Tiquet Dockerfile previously used Node 20 and mutable npm install; reconcile to Node 22 + npm ci and test isolated image build.
- Hub lineage: Hub's V79_HUB_TIQUET_SESSION_BINDING and Tiquet's V79_ENTITLEMENT_RECHECK_ENABLED / V79_TIQUET_SESSION_BINDING_ENABLED are separate gates. Default OFF; beta ON requires explicit coordinated two-app sign-off. No claim of live parity from source.
- Customer leakage: never read live .env, Docker inspect, production secrets, volumes or images. Synthetic Compose override uses a generated dummy env and detached config parsing only.
- Destructive migration: never invoke support rollback on a real server. Only local disposable DB matching exact localhost test URL, with existing job and account data protected.
- Restores: support PostgreSQL alone is insufficient. Include synthetic Hub store and upload data in rehearsal; assert integrity, and clearly disclose no cross-store atomicity or off-host recovery proof.
- Launch/logout: preserve Phase 8 signed-session and fail-closed behavior with regression tests. No real email, payments, launch URLs followed or prod binds.
- Security: no localhost source header accepted in release, no secret logging, no docker/podman remote context, no image push. Record risks, not invented production conclusions.

Release verdict until owner authorizes production-grade gates: **NO-GO**.
