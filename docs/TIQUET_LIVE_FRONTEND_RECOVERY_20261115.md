# Tiquet live-UI reconciliation — isolated review, 15 November 2026

Status: SOURCE RECOVERY IMPLEMENTED, local review branch; NOT DEPLOYED. No GitHub push or production change.

## Evidence and preservation
- New worktree review/tiquet-live-ui-parity-20261115 forked from planning commit 2822abf.
- Live frontend baseline is the November 9 production asset (SHA-256 verified in prior audit).
- Recovered November 8 release source from v79-release-candidates/tiquet-cancel-invoice-20261108 for ticket cancellation/reopening, invoice emailing/PDF and navigation.
- Recovered November 9 release source from the preserved tiquet-workflow.patch for admin-only CRM customer confirmation and staff workflow.
- Recovered November 6 UX source for the persisted dark/light theme, accessible sidebar/mobile navigation and icon.
- Preserved staged FFPRO Review documents and 20%/waive deposit controls through three-way source merge.
- Rebuilt due-date editor against existing authenticated, tenant-scoped due-date endpoint and restored private workspace invoice BCC settings.

## Source review and red team
Three options: use staged older UI (rejected: loses live controls); use production minified JS with new server (rejected: cannot safely evolve); reconstruct from exact stored release sources (chosen).
The reconstruction could still differ from the live UI. The compiled JS AST comparison showed about 98% literal coverage, not behavioural equivalence. Several wording/layout strings remain; treat this as a development diagnostic only.

## Test / release status
- Node unit and planning regression tests run on this isolated worktree.
- TypeScript and frontend build must pass after each source merge; tests/uiPreservation.test.cjs guards key live controls.
- NOT VERIFIED: authenticated browser with isolated Hub/MFA, real customer portal, visual/mobile screenshot comparison, complete source-level feature parity, off-host restore rehearsal and guarded rollback.
- NOT PERFORMED: production deployment, direct database changes, GitHub push, live credential use.

Do not release until all remaining acceptance gates pass. Existing Hub, payments, CRM and customer data remain untouched.

## Verified on isolated source worktree
- TypeScript: npm run lint PASS.
- Frontend: npm run build PASS.
- Planning and existing ticket unit regression: 40/40 PASS.
- Source preservation contract: 5/5 PASS.
- Rebuilt-versus-live compiled JS AST literal coverage: 98.33% (3046 live literals, 51 absent in rebuilt). This is not a behavioural or UI screenshot pass.
- Environment-based platform provisioning test cannot run without isolated V79_PLATFORM_SHARED_SECRET and other QA fixtures; do not substitute production credentials.
- Temporary three-way merge previews preserved in v79-integration-review-20261114/ui-parity/merge-preview-20261115 outside the worktree.

## Step 2 isolated browser acceptance (synthetic only)
- Actual Chrome against rebuilt Tiquet frontend on Acer localhost; synthetic admin/staff accounts, clients, job records, portal tokens and HTTP API mocks. Outbound non-local requests blocked.
- Final run: 16/16 PASS; zero unmocked API requests. Desktop/mobile/portal screenshots created.
- Covers dashboard JS errors, persisted theme, invoices/email buttons, 20% deposit, saved workspace BCC, due-date edit, admin-only CRM control, ticket cancellation UI, no broad whole-ticket PUT after narrow updates, non-admin CRM restriction, mobile navigation, unauthenticated redirection to a *synthetic* Hub login, one approved portal file, forged file response denied by mock, and zero review documents before Review.
- Two defects found and fixed in isolated source: absent invoiceCopyEmail mapping on session restore; duplicate broad whole-ticket PUT after narrow deposit/due-date API updates.
- Acer test harness/results/screenshots: /home/firelion/Projects/v79-tiquet-step2-browser-qa
- Server evidence JSON: /home/firelion/v79-integration-review-20261114/ui-parity/browser-acceptance-20261115.json
- This does not prove actual Hub authentication or MFA, email delivery, real-service authorisation, or production client file downloads. Cross-app isolated PG16 22/22 integration is separate evidence.
- Security gate remains open: set up isolated Hub identity with real MFA, Tiquet QA with synthetic tenant accounts, complete full authenticated browser acceptance and guard/restore rehearsal before production cutover.
