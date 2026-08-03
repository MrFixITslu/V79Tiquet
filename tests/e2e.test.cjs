const http = require('http');

const BASE_URL = process.env.API_URL || 'http://127.0.0.1:3001';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function runE2ETests() {
  console.log('=== Running End-to-End Workflow Tests ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 0. Setup User and Auth Token
    // API requires: name, email, password, companyName
    const userEmail = `e2e_user_${Date.now()}@example.com`;
    const userPassword = 'E2EPassword123!';

    const reg = await request('POST', '/api/auth/register', {
      email: userEmail,
      password: userPassword,
      name: 'E2E User',
      companyName: 'E2E Tech Solutions',  // Correct field name is 'companyName'
    });
    assert(reg.status === 201, `E2E User registration successful (Got: ${reg.status} — ${JSON.stringify(reg.body)})`);

    const login = await request('POST', '/api/auth/login', {
      email: userEmail,
      password: userPassword
    });
    assert(login.status === 200 && login.body && login.body.token, `E2E Login successful (Got: ${login.status})`);
    const token = login.body ? login.body.token : '';
    const authHeader = { Authorization: `Bearer ${token}` };

    if (!token) {
      console.error('  Cannot continue tests — no auth token received');
      process.exit(1);
    }

    // 1. Client Management Flow
    console.log('\n[1/4] Testing Client Management Flow...');
    const createClient = await request('POST', '/api/clients', {
      name: 'Acme Corporation',
      company: 'Acme Inc',
      email: 'contact@acme.com',
      phone: '555-0199',
      address: '123 Tech Blvd'
    }, authHeader);
    assert(createClient.status === 201, `Created new client (Got: ${createClient.status} — ${JSON.stringify(createClient.body)})`);
    const client = createClient.body;

    const listClients = await request('GET', '/api/clients', null, authHeader);
    assert(Array.isArray(listClients.body) && listClients.body.length > 0, `Listed clients successfully (Got: ${listClients.status})`);

    // 2. Job Creation & Lifecycle Flow
    console.log('\n[2/4] Testing Job Creation & Lifecycle Flow...');
    const createJob = await request('POST', '/api/jobs', {
      title: 'Full Website Redesign',
      description: 'Redesign corp site with modern UI',
      client: client ? client.name : 'Acme Corporation',
      clientEmail: 'contact@acme.com',
      priority: 'high',
      amount: 4500,
      status: 'estimation'
    }, authHeader);
    assert(createJob.status === 201 || createJob.status === 200, `Created new job (Got: ${createJob.status})`);
    const job = createJob.body;
    assert(job && job.secureToken, `Job assigned unique secure token for client portal`);

    // Update job stage
    if (job && job.id) {
      const updateJob = await request('PUT', `/api/jobs/${job.id}`, {
        ...job,
        status: 'in-progress'
      }, authHeader);
      assert(
        updateJob.status === 200 && updateJob.body && updateJob.body.status === 'in-progress',
        `Updated job status to in-progress (Got: ${updateJob.status})`
      );
    }

    // 3. Client Portal Access Flow
    console.log('\n[3/4] Testing Client Portal Interactivity...');
    if (job && job.secureToken) {
      const portalData = await request('GET', `/api/portal/${job.secureToken}`);
      assert(portalData.status === 200 && portalData.body && portalData.body.job, `Client accessed portal using secure token (Got: ${portalData.status})`);

      const approveQuote = await request('POST', `/api/portal/${job.secureToken}/approve-quote`);
      assert(approveQuote.status === 200, `Client approved quote via portal link (Got: ${approveQuote.status})`);

      const payDeposit = await request('POST', `/api/portal/${job.secureToken}/pay-deposit`);
      assert(payDeposit.status === 200, `Client paid deposit via portal link (Got: ${payDeposit.status})`);

      const clientMsg = await request('POST', `/api/portal/${job.secureToken}/messages`, {
        content: 'Excited for this project!'
      });
      assert(clientMsg.status === 201, `Client sent message via portal chat (Got: ${clientMsg.status})`);
    }

    // 4. Business Settings & Stripe Plans Flow
    console.log('\n[4/4] Testing Settings & Stripe Integration API...');
    const getSettings = await request('GET', '/api/settings', null, authHeader);
    assert(getSettings.status === 200, `Retrieved business settings (Got: ${getSettings.status})`);

    const getPlans = await request('GET', '/api/stripe/plans');
    assert(getPlans.status === 200 && getPlans.body && getPlans.body.pro, `Retrieved Stripe subscription plans`);

  } catch (err) {
    console.error('E2E test runner error:', err);
    failed++;
  }

  console.log(`\n=== E2E Test Results: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) process.exit(1);
}

runE2ETests();
