const test = require('node:test');
const assert = require('node:assert/strict');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
async function call(path, options = {}) {
  const response = await fetch(base + path, { ...options, redirect: 'manual' });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}
test('Hub-managed Tiquet rejects legacy account creation and unauthenticated customer access', async () => {
  const health = await call('/health/ready');
  assert.equal(health.response.status, 200);
  const registration = await call('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'recovery-test@example.test', password: 'not-used', name: 'Recovery Test' }) });
  assert.equal(registration.response.status, 410);
  assert.equal(registration.body.code, 'HUB_SIGNUP_REQUIRED');
  const login = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'recovery-test@example.test', password: 'not-used' }) });
  assert.equal(login.response.status, 410);
  const privateClients = await call('/api/clients');
  assert.equal(privateClients.response.status, 401);
  assert.equal(privateClients.response.headers.get('x-content-type-options'), 'nosniff');
});
