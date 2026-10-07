const http = require('http');

const BASE_URL = process.env.API_URL || 'http://127.0.0.1:3000';

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
    const initialPortalToken = job?.secureToken;

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

      const markPaid = await request('PUT', `/api/jobs/${job.id}`, {
        ...updateJob.body,
        status: 'paid'
      }, authHeader);
      assert(
        markPaid.status === 409 && markPaid.body && markPaid.body.code === 'PAYMENT_REQUIRED',
        `Unfunded job cannot be marked paid directly (Got: ${markPaid.status})`
      );
      job.secureToken = updateJob.body.secureToken;
      assert(job.secureToken === initialPortalToken, 'Normal status updates preserve the active client portal credential');
    }

    // 3. Client Portal Access Flow
    console.log('\n[3/4] Testing Client Portal Interactivity...');
    if (job && job.secureToken) {
      const portalData = await request('GET', `/api/portal/${job.secureToken}`);
      assert(portalData.status === 200 && portalData.body && portalData.body.job, `Client accessed portal using secure token (Got: ${portalData.status})`);
      assert(!portalData.body.job.secureToken, 'Client portal response does not leak its bearer credential');

      const approveQuote = await request('POST', `/api/portal/${job.secureToken}/approve-quote`);
      assert(approveQuote.status === 200, `Client approved quote via portal link (Got: ${approveQuote.status})`);

      const payDeposit = await request('POST', `/api/portal/${job.secureToken}/pay-deposit`);
      assert(
        payDeposit.status === 503 && payDeposit.body && payDeposit.body.code === 'BILLING_NOT_CONFIGURED',
        `Portal checkout fails closed when V79 Billing is not configured (Got: ${payDeposit.status})`
      );

      const clientMsg = await request('POST', `/api/portal/${job.secureToken}/messages`, {
        content: 'Excited for this project!'
      });
      assert(clientMsg.status === 201, `Client sent message via portal chat (Got: ${clientMsg.status})`);

      const revokedToken = job.secureToken;
      const revokePortal = await request('POST', `/api/jobs/${job.id}/revoke-portal`, null, authHeader);
      assert(revokePortal.status === 200, `Staff can revoke a client portal link (Got: ${revokePortal.status})`);
      const revokedPortal = await request('GET', `/api/portal/${revokedToken}`);
      assert(revokedPortal.status === 404, `Revoked portal link is rejected (Got: ${revokedPortal.status})`);

      const reissuePortal = await request('POST', `/api/jobs/${job.id}/send-portal`, null, authHeader);
      assert(reissuePortal.status === 200, `Staff can issue a replacement portal link (Got: ${reissuePortal.status})`);
      const refreshedJobs = await request('GET', '/api/jobs', null, authHeader);
      const refreshedJob = Array.isArray(refreshedJobs.body) ? refreshedJobs.body.find((row) => row.id === job.id) : null;
      assert(refreshedJob && refreshedJob.secureToken && refreshedJob.secureToken !== revokedToken, 'Replacement portal link rotates the bearer credential');
      job.secureToken = refreshedJob?.secureToken || job.secureToken;
      const replacementPortal = await request('GET', `/api/portal/${job.secureToken}`);
      assert(replacementPortal.status === 200, `Replacement portal link is active (Got: ${replacementPortal.status})`);

      const partial = await request('POST', '/api/payments', {
        jobId: job.id,
        amount: 1350,
        method: 'bank_transfer',
        reference: 'E2E-DEPOSIT',
        receivedAt: new Date().toISOString()
      }, authHeader);
      assert(
        partial.status === 201 && partial.body && partial.body.summary && partial.body.summary.paidAmount === 1350,
        `Recorded partial payment without marking job paid (Got: ${partial.status})`
      );
      assert(partial.body.job.status !== 'paid', 'Partial payment does not falsely mark the job paid');

      const invoiceJob = await request('PUT', `/api/jobs/${job.id}`, {
        ...partial.body.job,
        status: 'invoiced'
      }, authHeader);
      assert(invoiceJob.status === 200 && invoiceJob.body.status === 'invoiced', `Moved funded job to invoiced (Got: ${invoiceJob.status})`);

      const finalPayment = await request('POST', '/api/payments', {
        jobId: job.id,
        amount: 3150,
        method: 'bank_transfer',
        reference: 'E2E-FINAL',
        receivedAt: new Date().toISOString()
      }, authHeader);
      assert(
        finalPayment.status === 201 && finalPayment.body && finalPayment.body.job && finalPayment.body.job.status === 'paid',
        `Full recorded settlement closes invoiced job as paid (Got: ${finalPayment.status})`
      );

      const paymentList = await request('GET', `/api/payments?jobId=${job.id}`, null, authHeader);
      assert(
        paymentList.status === 200 && Array.isArray(paymentList.body) && paymentList.body.length === 2,
        `Payment ledger retained both partial and final payments (Got: ${paymentList.status})`
      );

      // Test Job Deletion
      const deleteJob = await request('DELETE', `/api/jobs/${job.id}`, null, authHeader);
      assert(deleteJob.status === 200 && deleteJob.body && deleteJob.body.success, `Deleted job successfully (Got: ${deleteJob.status})`);
    }

    // 4. Business Settings & Hub-managed Billing Flow
    console.log('\n[4/4] Testing Settings & Hub-managed Billing API...');
    const getSettings = await request('GET', '/api/settings', null, authHeader);
    assert(getSettings.status === 200, `Retrieved business settings (Got: ${getSettings.status})`);

    const getPlans = await request('GET', '/api/stripe/plans');
    assert(
      getPlans.status === 200 &&
      getPlans.body &&
      getPlans.body.billingManagedBy === 'v79-hub' &&
      Array.isArray(getPlans.body.plans) &&
      getPlans.body.plans.length === 0,
      `Tiquet correctly delegates subscription billing to V79 Hub (Got: ${getPlans.status})`
    );

  } catch (err) {
    console.error('E2E test runner error:', err);
    failed++;
  }

  console.log(`\n=== E2E Test Results: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) process.exit(1);
}

runE2ETests();
