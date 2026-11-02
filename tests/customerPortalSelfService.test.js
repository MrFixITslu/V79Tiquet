import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import {
  createCustomerPortalRouter, normalizeCustomerEmail, safePortalName,
  portalHash, portalOriginAllowed, safeTicketText
} from '../server/customerPortalSelfService.js';

const TEST_ORIGIN = 'http://127.0.0.1:3000';
const DB_URL = process.env.V79_PORTAL_TEST_DATABASE_URL;
function expectSafeInputs() {
  assert.equal(normalizeCustomerEmail(' Person@Example.COM '), 'person@example.com');
  assert.equal(normalizeCustomerEmail('not-an-email'), null);
  assert.equal(normalizeCustomerEmail('<script>@test.com'), null);
  assert.equal(safePortalName(' Test  Person '), 'Test Person');
  assert.equal(safePortalName('<svg>'), null);
  assert.equal(safeTicketText('Office Wi-Fi', 140), 'Office Wi-Fi');
  assert.equal(safeTicketText('bad\u0000text', 140), null);
  assert.equal(portalOriginAllowed('https://tiquet.v79sl.com', 'https://tiquet.v79sl.com'), true);
  assert.equal(portalOriginAllowed('https://tiquet.v79sl.com.evil.test', 'https://tiquet.v79sl.com'), false);
  assert.equal(portalOriginAllowed('null', 'https://tiquet.v79sl.com'), false);
  assert.equal(portalHash('do-not-share'), portalHash('do-not-share'));
}
test('customer portal input, origin and immutable digest contracts', expectSafeInputs);

test('P4 customer-only portal isolated PostgreSQL request/verification/replay/tenant boundary', { skip: !DB_URL }, async () => {
  const pool = new pg.Pool({ connectionString: DB_URL, max: 4, connectionTimeoutMillis: 4000 });
  const adapter = {
    query: (sql, params) => pool.query(sql, params),
    transaction(fn) {
      return async () => {
        const client = await pool.connect();
        await client.query('BEGIN');
        try {
          const value = await fn({ query: (sql, params) => client.query(sql, params) });
          await client.query('COMMIT'); return value;
        } catch (e) {
          await client.query('ROLLBACK'); throw e;
        } finally { client.release(); }
      };
    }
  };
  const emails = [];
  const sendEmail = async (to, subject, html) => {
    emails.push({ to, subject, html });
    return { success: true, skipped: false };
  };
  const app = express();
  app.use(express.json());
  app.use('/api/customer', createCustomerPortalRouter({
    db: adapter, sendEmail, accountId: 'test-tenant-A',
    publicUrl: TEST_ORIGIN, production: false
  }));
  app.use('/api/tenant-B', createCustomerPortalRouter({
    db: adapter, sendEmail, accountId: 'test-tenant-B',
    publicUrl: TEST_ORIGIN, production: false
  }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const req = async (route, method = 'GET', data, cookie, origin = TEST_ORIGIN, key) => {
    const result = await fetch(base + route, {
      method,
      headers: {
        ...(method === 'POST' ? { 'Content-Type': 'application/json', Origin: origin } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(key ? { 'Idempotency-Key': key } : {})
      },
      body: data === undefined ? undefined : JSON.stringify(data)
    });
    return { status: result.status, body: await result.json(), cookie: result.headers.get('set-cookie')?.split(';')[0] };
  };
  try {
    await pool.query(`INSERT INTO accounts (id, name, createdat, status) VALUES
      ('test-tenant-A','Synthetic Tenant A','2026-11-01','active'),
      ('test-tenant-B','Synthetic Tenant B','2026-11-01','active') ON CONFLICT DO NOTHING`);
    let r = await req('/api/customer/tickets', 'GET');
    assert.equal(r.status, 401);
    r = await req('/api/customer/tickets', 'GET', undefined, 'tiquet_session='+'a'.repeat(64));
    assert.equal(r.status, 401, 'staff token is never customer credential');
    r = await req('/api/customer/register', 'POST',
      { name: 'Synthetic Client', email: 'Client@Example.test', consent: true, accountId:'test-tenant-B' },
      undefined, 'https://evil.example');
    assert.equal(r.status, 403, 'cross-origin registration blocked');
    r = await req('/api/customer/register', 'POST',
      { name: 'Synthetic Client', email: 'Client@Example.test', consent: true, accountId:'test-tenant-B' });
    assert.equal(r.status, 202);
    const verif = emails.at(-1).html.match(/token=([a-f0-9]{64})/)[1];
    assert.equal(emails.length, 1);
    assert.ok(!JSON.stringify(r.body).includes(verif), 'never return token in HTTP registration');
    r = await req('/api/customer/verify', 'POST', { token: verif });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const customerCookie = r.cookie;
    assert.match(customerCookie, /^tiquet_customer_session=/);
    const realClients = await pool.query('SELECT id,account_id,email FROM clients');
    assert.equal(realClients.rowCount, 1);
    assert.equal(realClients.rows[0].account_id, 'test-tenant-A');
    assert.equal(realClients.rows[0].email, 'client@example.test');
    const privacy = await pool.query("SELECT service_consent_at,service_consent_version FROM customer_portal_identities WHERE email='client@example.test'");
    assert.ok(privacy.rows[0]?.service_consent_at);
    assert.equal(privacy.rows[0].service_consent_version, '2026-11-service-v1');
    const marketingConsent = await pool.query('SELECT newsletteroptin FROM clients WHERE id=$1', [realClients.rows[0].id]);
    assert.equal(marketingConsent.rows[0].newsletteroptin, 0, 'service consent is not marketing consent');
    r = await req('/api/customer/verify', 'POST', { token: verif });
    assert.equal(r.status, 400, 'verification replay denied');
    r = await req('/api/customer/register', 'POST',
      { name: 'Expired Test', email: 'expired@example.test', consent: true });
    assert.equal(r.status, 202);
    const expiredToken = emails.at(-1).html.match(/token=([a-f0-9]{64})/)[1];
    await pool.query("UPDATE customer_portal_identities SET token_expires_at=now()-interval '1 second' WHERE email='expired@example.test'");
    r = await req('/api/customer/verify', 'POST', { token: expiredToken });
    assert.equal(r.status, 400, 'expired verification link denied');
    r = await req('/api/customer/me', 'GET', undefined, customerCookie);
    assert.equal(r.status, 200);
    r = await req('/api/tenant-B/me', 'GET', undefined, customerCookie);
    assert.equal(r.status, 401, 'tenant A cookie invalid in B');
    r = await req('/api/customer/tickets', 'GET', undefined, customerCookie);
    assert.deepEqual(r.body.tickets, []);
    const idem = 'synthetic-ticket-idempotency-key-0001';
    const dangerous = { title: 'Office Wi-Fi', description: 'Please contact us', status: 'paid',
      amount: 1000000, accountId: 'test-tenant-B', clientId: 'attacker-supplied', scheduled: true };
    r = await req('/api/customer/tickets', 'POST', dangerous, customerCookie, TEST_ORIGIN, idem);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.scheduled, false);
    const ticketId = r.body.ticket.id;
    r = await req('/api/customer/tickets', 'POST', dangerous, customerCookie, TEST_ORIGIN, idem);
    assert.equal(r.status, 201);
    assert.equal(r.body.ticket.id, ticketId, 'idempotency resubmission must not create duplicate');
    const dbTicket = await pool.query('SELECT status,account_id,clientid,amount FROM jobs');
    assert.equal(dbTicket.rowCount, 1);
    assert.equal(dbTicket.rows[0].status, 'request');
    assert.equal(dbTicket.rows[0].account_id, 'test-tenant-A');
    assert.equal(dbTicket.rows[0].clientid, realClients.rows[0].id);
    assert.equal(dbTicket.rows[0].amount, null);
    r = await req('/api/customer/tickets/'+ticketId+'/messages', 'GET', undefined, customerCookie);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.messages, []);
    const messageKey = 'synthetic-message-idempotency-001';
    const sent = { content: 'Please contact me before visiting.', sender: 'Admin',
      accountId: 'test-tenant-B', jobId: 'attacker-selected' };
    r = await req('/api/customer/tickets/'+ticketId+'/messages', 'POST', sent,
      customerCookie, TEST_ORIGIN, messageKey);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.message.sender, 'Client', 'client cannot forge staff sender');
    const recordedMessageId = r.body.message.id;
    r = await req('/api/customer/tickets/'+ticketId+'/messages', 'POST', sent,
      customerCookie, TEST_ORIGIN, messageKey);
    assert.equal(r.status, 201);
    assert.equal(r.body.message.id, recordedMessageId, 'retry is idempotent');
    r = await req('/api/customer/tickets/'+ticketId+'/messages', 'POST',
      { content: 'Changed message!' }, customerCookie, TEST_ORIGIN, messageKey);
    assert.equal(r.status, 409, 'same message idempotency key cannot change content');
    r = await req('/api/customer/tickets/'+ticketId+'/messages', 'GET', undefined, customerCookie);
    assert.equal(r.status, 200);
    assert.equal(r.body.messages.length, 1);
    // A second customer within the SAME tenant must remain invisible.
    const secondClientId = crypto.randomUUID(), secondJobId = crypto.randomUUID();
    await pool.query(
      'INSERT INTO clients (id,account_id,name,email,createdat) VALUES ($1,$2,$3,$4,$5)',
      [secondClientId,'test-tenant-A','Different Client','other@example.test','2026-11-01']);
    await pool.query(
      `INSERT INTO jobs (id,title,description,status,createdat,priority,client,clientemail,clientid,account_id)
       VALUES ($1,'Private Job','Must not leak','request','2026-11-01','medium','Different Client','other@example.test',$2,'test-tenant-A')`,
      [secondJobId,secondClientId]);
    r = await req('/api/customer/tickets', 'GET', undefined, customerCookie);
    assert.equal(r.body.tickets.length, 1, 'same-tenant different-client ticket hidden');
    r = await req('/api/customer/tickets/'+secondJobId, 'GET', undefined, customerCookie);
    assert.equal(r.status, 404, 'direct object reference to other client denied');
    r = await req('/api/customer/tickets/'+secondJobId+'/messages', 'GET', undefined, customerCookie);
    assert.equal(r.status, 404, 'other client messages not readable');
    r = await req('/api/customer/tickets/'+secondJobId+'/messages', 'POST',
      { content: 'Unauthorized comment' }, customerCookie, TEST_ORIGIN, 'another-client-message-key-0001');
    assert.equal(r.status, 404, 'other client messages not writable');
    r = await req('/api/tenant-B/tickets/'+ticketId, 'GET', undefined, customerCookie);
    assert.equal(r.status, 401);
    r = await req('/api/customer/tickets/'+crypto.randomUUID(), 'GET', undefined, customerCookie);
    assert.equal(r.status, 404);
    r = await req('/api/customer/request-login', 'POST', { email: 'client@example.test' });
    assert.equal(r.status, 202);
    const login = emails.at(-1).html.match(/token=([a-f0-9]{64})/)[1];
    r = await req('/api/customer/login', 'POST', { token: login });
    assert.equal(r.status, 200);
    const returningCookie = r.cookie;
    r = await req('/api/customer/login', 'POST', { token: login });
    assert.equal(r.status, 400, 'sign-in link replay denied');
    r = await req('/api/customer/logout', 'POST', {}, returningCookie);
    assert.equal(r.status, 200);
    r = await req('/api/customer/me', 'GET', undefined, returningCookie);
    assert.equal(r.status, 401, 'logout revokes the exact session');
    await pool.query("UPDATE accounts SET status='suspended' WHERE id='test-tenant-A'");
    r = await req('/api/customer/me', 'GET', undefined, customerCookie);
    assert.equal(r.status, 401, 'suspended tenant cannot use previously valid session');
    console.log('P4_PORTAL_SYNTHETIC_SECURITY=PASS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
