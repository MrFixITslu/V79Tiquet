# Hub + Tiquet acceptance evidence — operator-reported contract v1

**Status: DEVELOPMENT / VALIDATION ONLY.** This is a read-only local input validator and a nondeploying GitHub Actions job. It does not contact Hub, Tiquet, WiPay, Resend, Sentinel, Docker, databases, a browser or the internet. It is not a security attestation or a deployment prerequisite that can turn green by checking its own output.

## Why this exists
Keep one machine-readable response for the existing A01–A15 owner acceptance plan instead of exchanging fragmented chat logs. Reuse this report across the release coordinator, QA and REDTEAM workstreams. Preserve the existing public Hub/Tiquet feature freeze. No new app logic is introduced.

**Local procedure, only with a copy of an approved isolated synthetic fixture and no secrets:**

1. Run `node scripts/launch-acceptance-evidence.cjs --template > private-acceptance.json`.
2. In the private, operator-controlled workspace, fill the pinned candidate SHA/image identities and mark each case only as `not_run`, `blocked`, `failed` or `reported_pass`. A reported pass requires a SHA-256 of the separately stored **redacted** evidence. Never include browser cookies, MFA codes, access tokens, PII, bank information or screenshots in this file.
3. Run `node scripts/launch-acceptance-evidence.cjs --check private-acceptance.json`. The script does not modify it or make calls; it returns only a sanitized coverage summary, with explicit outstanding case IDs and unknown candidate identities.
4. Independent reviewers must open the redacted evidence outside this checker, confirm actual target, time, environment, exact images/source, test results and negative cases, and retain signed approval separately. **Do not promote a reported result to verified based on a supplied hash alone.**
5. DO NOT use this report's exit status to drive CI release, Docker, billing or account mutation. `production_decision` is permanently `NO-GO` by design.

### Case allocation

| Cases | Focus | Execution boundary |
|---|---|---|
| A01–A03 | Invite-only signup, founder MFA, role-specific authorization | Isolated approved synthetic accounts, never live founder reset |
| A04–A06 | Hub-to-Tiquet dashboard without a second login; expired/replayed tickets; two-tenant denial | Isolated browser and exact fixture identities |
| A07–A10 | Logout/expiry, revocation, password recovery, mobile/accessibility | Controlled sessions, clock/fixtures; never change live service clock |
| A11–A12 | WiPay negative paths and authorized sandbox callback | No real card charge; A12 requires `provider_sandbox` mode if reporting a pass |
| A13–A14 | Manual transfer negative and concurrency tests | Disposable restored database only, no real funds or entitlements |
| A15 | Invitation/recovery/reminder and provider mail receipts | Explicit owner-approved test inboxes and separately authorized sandbox send |

Positive cases and provider effects are not executed by this tool. Cases may be reported as incomplete indefinitely without risk.

### Red-team constraints

- Only four envelope keys and four fields per case are allowed; duplicate/missing/extra case IDs and secret-looking added fields are rejected. Strict lower-case SHA hex is required where provided.
- A single supplied hash is **integrity metadata**, not proof that a test was executed or witnessed.
- Synthetic authentication unit tests, UI renders and local provider mocks do **not** validate actual browser SSO, merchant settlement, owner MFA, tenant isolation at runtime or restored image compatibility.
- If any high-risk action has an unknown outcome, mark `blocked` and investigate read-only. Never auto-retry an uncertain ticket creation, payment, mail send, account cleanup or deployment.
- This is stacked on Tiquet PR #32 **HOLD**. The HOLD is not merged into production main; normal Tiquet main pushes still carry existing auto-deploy risk. Keep this branch draft and out of main until release-control approval.

Related: Hub issue #113/#128, draft Hub PR #130, draft Tiquet PR #32, the owner acceptance plan in Hub #130, and the independent customer security gate.
