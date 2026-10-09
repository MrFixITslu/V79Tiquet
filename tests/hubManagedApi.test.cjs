// Integration contract for Hub-managed Tiquet. Run only against a disposable isolated instance.
const assert = require('node:assert/strict');
const { URL } = require('node:url');
const base = new URL(process.env.TIQUET_TEST_BASE_URL || 'http://127.0.0.1:3000');
if (!['127.0.0.1', 'localhost'].includes(base.hostname) || base.protocol !== 'http:') {
  throw new Error('Refusing to run: the test target must be local HTTP loopback.');
}
const request = async (path, options = {}) => {
  const response = await fetch(new URL(path, base), {
    ...options,
    headers: {'content-type': 'application/json', ...(options.headers || {})},
    signal: AbortSignal.timeout(6000),
  });
  return {status: response.status, body: await response.json().catch(() => ({})), headers: response.headers};
};
(async () => {
  const health = await request('/health/ready');
  assert.equal(health.status, 200);
  assert.equal(health.body.database, 'connected');

  const signup = await request('/api/auth/register', {
    method:'POST', body:JSON.stringify({
      name:'Isolated Tiquet Test', email:'sandbox-user@example.test',
      password:'NeverPersistThisTestPassword', companyName:'Sandbox Only',
    }),
  });
  assert.equal(signup.status, 410, 'Direct registration must remain disabled in Hub-managed mode.');
  assert.equal(signup.body.code, 'HUB_SIGNUP_REQUIRED');

  const login = await request('/api/auth/login', {
    method:'POST', body:JSON.stringify({email:'sandbox-user@example.test',password:'invalid'}),
  });
  assert.equal(login.status, 410, 'Direct login must not bypass Hub.');
  assert.equal(login.body.code, 'HUB_AUTH_REQUIRED');

  const clients = await request('/api/clients');
  assert.equal(clients.status, 401, 'Client records must require authenticated access.');
  const jobs = await request('/api/jobs');
  assert.equal(jobs.status, 401, 'Job records must require authenticated access.');

  const probe = await request('/health');
  assert.equal(probe.status, 200);
  assert.equal(clients.headers.get('x-content-type-options'), 'nosniff');
  console.log('Hub-managed Tiquet API integration contract passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
