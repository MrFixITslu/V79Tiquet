# Stage 4 — supervised Tiquet draft release checklist

**Release status: BLOCKED / draft PR #27. Do not merge or deploy.**

## Implemented and verified

- Validates strict signed-handoff payload shape: organisation ID, Hub owner ID, approved proposal UUID, selected ticket ID, and bounded internal review text.
- The existing `/api/platform` middleware authenticates Hub service ID, HMAC-SHA256 body integrity, and timestamp (5-minute skew). Signed endpoint remains **disabled by default** using `V79_AGENT_SUPERVISED_DRAFTS_ENABLED`.
- Links an existing active Tiquet account to `hub_organization_id` and requires a local `Admin` user matching the exact `hub_user_id`.
- Uses `createAgentReplyDraft` to validate ownership of the selected ticket and persist a **DRAFT-only** record, with deterministic proposal-based idempotency.
- Contains a pure owner-scoped ticket-selector helper. It returns only **ID/title/status**, capped to 50 rows (no customer details).
- Focused unit tests: 8 passed. PR CI: passed.
- Disposable PostgreSQL 16 restore test (from a pre-refresh backup) passed. Synthetic account, owner and ticket were created **inside the temporary offline container**, owner lookup/ticket listing/cross-tenant denial were verified, then rolled back. Baseline record counts before/after: 3 accounts, 2 users, 2 jobs, 1 existing draft. Live database untouched; temporary container removed.

## Not implemented — release blockers

1. Expose the **ticket-list helper** through a new endpoint beneath the existing authenticated `/api/platform` router, with `Cache-Control: no-store`, default-off feature gate and a strict two-key request body. Do not make ticket selection public or return client personal data.
2. Add Hub **MFA-owner-only** access to the signed Tiquet selection endpoint. Organisation and owner identity must be derived from the verified Hub session, never client request data.
3. Present the returned ticket list in Hub's **approved support-proposal** UI. Require the owner to select a specific ticket and **separately confirm** creation. Blank, missing and cross-organisation tickets must fail closed.
4. The Hub draft-creation route must verify owner MFA, keyed approval audit integrity, proposal tenant/status/expiry/operation, strict selected ticket ID, and the Tiquet service's signed response. Accept only receipt `status=DRAFT`, `sent=false`, `published=false`, `scheduled=false`.
5. Authenticated HTTP integration tests must cover unsigned/expired/tampered signatures, cross-org and staff denial, rejected/expired proposals, missing or mismatched tickets, repeat confirmation/idempotency, and *zero* customer-message or notification writes.
6. **Reconfirm release approval**, take a fresh Tiquet PostgreSQL backup and Hub state backup, tag both current images, deploy receiver disabled before Hub, verify data digests, and enable switches **one at a time** after passing the gates.
7. Owner acceptance: select an existing ticket, save an internal reply draft, refresh, confirm the same ticket and draft remain visible and **no customer message or email was sent**.

The automatic customer-reply/publishing paths must stay disabled. The working Marketing supervised draft integration remains independent and must not be modified by this Tiquet release.

> Previously, execution controls prevented modifying the missing integration endpoints. Do not bypass that restriction; the owner/maintainer must supply an authorised implementation route before deployment.
