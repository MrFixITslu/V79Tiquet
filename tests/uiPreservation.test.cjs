const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const has = (contents, ...needles) => needles.forEach(needle =>
  assert.ok(contents.includes(needle), 'Required live UI contract missing: ' + needle));

test('legacy ticket cancellation, reopening and due-date editing are present', () => {
  const detail = source('src/components/JobDetailModal.tsx');
  has(detail, '"/cancel"', '"/reopen"', '"/due-date"', 'Cancel Ticket', 'Reopen Ticket', 'Edit ticket due date');
  const server = source('server/index.js');
  has(server, '"/api/jobs/:id/cancel"', '"/api/jobs/:id/reopen"', '"/api/jobs/:id/due-date"');
});
test('invoice email, PDF, BCC and FFPRO deposit decision controls coexist', () => {
  has(source('src/components/Invoices.tsx'), '"/send-invoice"', '"/invoice.pdf"', 'Email Invoice', 'Resend Invoice',
      'Review deposit decisions', 'review-deposit-policy');
  has(source('src/components/Settings.tsx'), 'Invoice copy (BCC)', 'invoiceCopyEmail');
  has(source('server/billingOptions.js'), 'invoiceBccForWorkspace', 'normalizeInvoiceCopyEmail');
  has(source('src/types.ts'), 'invoiceCopyEmail', 'depositPolicy');
  has(source('src/App.tsx'), 'invoiceCopyEmail: settings?.invoiceCopyEmail ??');
});
test('CRM confirmation is admin-only and retains client identity', () => {
  has(source('src/App.tsx'), 'canConfirmCustomer={currentUser?.role === "Admin"}');
  has(source('src/components/JobDetailModal.tsx'), 'WebsiteEnquiryConfirmation');
  has(source('src/components/WebsiteEnquiryConfirmation.tsx'), '"/customer-confirmation"', 'canConfirmCustomer', 'crmCustomerId');
  has(source('server/index.js'), '"/api/jobs/:id/customer-confirmation", authenticateToken, requireAdmin');
});
test('private drafts, project files and portal access remain wired', () => {
  has(source('src/components/JobDetailModal.tsx'), 'AgentReplyDraftPanel');
  has(source('src/components/ClientPortal.tsx'), 'ClientReviewDocuments');
  has(source('src/components/JobBoard.tsx'), 'showCancelled');
  has(source('src/navigationState.js'), 'readTiquetJobId');
});
test('theme, mobile navigation and preferences are retained', () => {
  has(source('src/App.tsx'), 'v79-tiquet-theme', 'tiquet-theme-toggle', 'data-theme={theme}');
  has(source('src/components/Sidebar.tsx'), 'aria-current={active ? "page" : undefined}', 'Close navigation overlay');
  has(source('src/index.css'), '.v79-tiquet-app[data-theme="light"]', '.v79-tiquet-app[data-theme="dark"]');
});

test('dedicated ticket updates do not issue a second whole-record save', () => {
  const inv = source('src/components/Invoices.tsx');
  const deposit = inv.slice(inv.indexOf('const saveReviewDeposit'), inv.indexOf('const [invoiceNotice'));
  assert.ok(!deposit.includes('setJobs('), 'Deposit update must not overwrite the whole ticket');
  const detail = source('src/components/JobDetailModal.tsx');
  const due = detail.slice(detail.indexOf('const saveDueDate'), detail.indexOf('const submitCancel'));
  assert.ok(due.includes('if (onChanged) await onChanged();'), 'Due date must reload canonical state');
});
