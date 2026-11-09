# Vision79 Website → Tiquet → CRM workflow

Status: **Prepared and tested in isolated development worktrees. Not deployed.**

## Decision

Option 1, moving CRM into Tiquet, would limit sales visibility across other apps. Option 2, connecting Tiquet to the existing website CRM, is the immediate choice. Option 3, a Hub-wide CRM, remains the long-term direction.

## Workflow A — website enquiry

1. The website saves the enquiry in its existing CRM and forwards it to Tiquet using the established durable intake event ID.
2. Tiquet creates the ticket only once and issues a readable reference like TQ-F51AB2461234, with a private 14-day tracking link.
3. Acknowledgement email thanks the customer, displays their reference and request summary, and clearly says that Vision79 will call to confirm requirements before work begins.
4. Delivery is tracked. SMTP acceptance counts as sent, not proof of inbox delivery. Failures are queued for bounded retry and visible in Tiquet.
5. Staff call the customer and enter notes. An authorised Admin selects Confirm & Convert to Customer, Call Back, or Declined.
6. Confirmation invokes the website CRM through a service-to-service secret, validates the original intake event and tenant, then records the linked CRM lead and customer IDs on the Tiquet ticket.
7. Repeat enquiries from an existing customer become separate sales opportunities with the **same customer ID**; no extra customer identity is created.
8. Tiquet work assignment, estimation, billing and payment remain separate actions.

## Workflow B — direct or existing-customer tickets

The existing behaviour is preserved; no CRM conversion is automatically applied to staff-created tickets, other tenants or Hub support tickets. Additional rules for this second workflow can be defined separately.

## Release configuration (not applied)

Tiquet: INTAKE_ACCOUNT_ID, existing INTAKE_SECRET, TIQUET_WEBSITE_CRM_CONVERT_URL, TIQUET_WEBSITE_CRM_SECRET, correct public APP_BASE_URL, and verified SMTP sender.

Website: TIQUET_CRM_SHARED_SECRET (same new 32+ character value), TIQUET_CRM_ACCOUNT_ID (exact Vision79 Tiquet account ID). Preserve Hub SSO/MFA, intake secret and customer data permissions.

Do not commit secrets to Git or expose them in browsers. Both credentials must be installed only with deployment approval.

## Red-team safeguards

- An anonymous visitor can submit but cannot promote themselves to a customer.
- The conversion is admin-only and checks both the account and exact intake event; matches by display name alone are prohibited.
- Missing or ambiguous CRM leads fail closed and require manual resolution.
- A failed CRM response does not claim that a customer was converted; retry is safe.
- Welcome emails have an atomic send lease and bounded retries. A rare duplicate remains possible if the SMTP server accepts a message just before a process crash; test provider idempotency before scale.
- Historical tickets are not backfilled with unwanted welcome emails.
- No ticket is paid, invoiced, completed or cancelled automatically as a consequence of lead conversion.
- This release must preserve the currently deployed modern website and Tiquet user interfaces.

## Test evidence

- 84 Tiquet unit tests passed, plus website validation and customer-idempotence tests.
- TypeScript and application builds passed on both isolated source trees.
- Chrome browser test passed for the website enquiry panel, guarded confirmation button, ticket navigation and theme.
- Disposable website + Tiquet + PostgreSQL integration passed: lead capture, idempotent submission, ticket creation, tracking link expiry, unavailable SMTP, unauthorised access denial, call outcomes, CRM conversion, repeat click, CRM readback and repeat customer reuse.
- No test contacted real customers or deployed production code.

## Production gate

Review the email template, carry out a real test-inbox delivery, confirm the website source against the *latest* production build, test Hub Admin permissions, then take validated backups before a guarded deployment. Website bridge must be enabled before enabling Tiquet conversion.

**Release withheld: no production deployment performed.**
