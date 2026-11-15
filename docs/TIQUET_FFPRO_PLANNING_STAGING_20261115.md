# Tiquet-FFPRO planning - isolated staging release
Source implemented. 40 Tiquet tests, 30 FFPRO tests, 22 real PostgreSQL cross-app checks and builds PASS. NOT DEPLOYED.

## Business workflow
- Approved quote queues a Tiquet planning outbox event, creating one FFPRO project under the mapped Hub organisation.
- FFPRO planning completion queues callback to Tiquet Review, no duplicate stage or activity on retries.
- Review -> Invoiced queues FFPRO project closure without recording payment or revenue.
- Reviewer selects 20% deposit or waives; legacy tickets retain 30%. Invoices permissions are required.
- Client portal shows only selected, immutable file grants, requiring valid portal token and linked account/project.
- Staff review queue excludes legacy jobs without FFPRO project links.

## Deployment safeguards
Review live frontend against candidate; UI/browser/SSO/MFA acceptance is pending.
Verify off-host backups, schema migration and rollback before production cutover.
No customer records, payment secrets, live images or original dirty source worktrees touched.
No GitHub push or merge.
