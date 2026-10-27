// Isolated visual QA. Runs real React UI behind intercepts; NEVER connects to live Hub/Tiquet.
// All customer, user, billing and ticket information is synthetic.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const base = "http://127.0.0.1:4173";
const output = path.resolve(process.env.V79_VISUAL_DIR || "visual-review-artifacts");
fs.mkdirSync(output, { recursive: true });

const now = "2026-10-27T12:00:00.000Z";
const jobs = [
  { id: "qa-job-1", title: "Fibre office installation", client: "Sample Harbour Ltd",
    clientId: "qa-client-1", description: "Synthetic installation request for visual testing.",
    status: "in-progress", priority: "high", assignedTo: "Alex Taylor",
    createdAt: now, dueDate: "2026-11-03", amount: 850, tags: ["fibre"],
    activityLog: [{ id: "qa-log-1", action: "Installation scheduled", timestamp: now, user: "QA Operator" }] },
  { id: "qa-job-2", title: "Wi-Fi coverage review", client: "Sample Village Co",
    clientId: "qa-client-2", description: "Synthetic network survey.", status: "request",
    priority: "medium", createdAt: now, dueDate: "2026-11-04", amount: 275, activityLog: [] },
  { id: "qa-job-3", title: "Network equipment setup", client: "Sample Harbour Ltd",
    clientId: "qa-client-1", description: "Synthetic invoiced job.", status: "invoiced",
    priority: "low", assignedTo: "Alex Taylor", createdAt: now, amount: 440, activityLog: [] },
  { id: "qa-job-4", title: "Structured cabling audit", client: "Sample Village Co",
    clientId: "qa-client-2", description: "Synthetic job in review.", status: "review",
    priority: "high", createdAt: now, amount: 760, activityLog: [] }
];
const clients = [
  { id: "qa-client-1", name: "Sample Harbour Ltd", company: "Harbour Services",
    email: "contact@sample.invalid", phone: "000-000-0000",
    address: "Demo Street, Example Town", createdAt: now },
  { id: "qa-client-2", name: "Sample Village Co", company: "Village Co",
    email: "office@sample.invalid", phone: "000-000-0001",
    address: "Example Road, Test Town", createdAt: now }
];
const employees = [{
  id: "qa-employee-1", name: "Alex Taylor", role: "Field Technician",
  salary: 0, hourlyRate: 25, workerType: "hourly", paymentMethod: "Bank Transfer",
  status: "active", hoursWorked: 8
}];
const payments = [{
  id: "qa-payment-1", jobId: "qa-job-3", amount: 100,
  method: "bank_transfer", receivedAt: now, recordedAt: now, status: "recorded"
}];
const settings = {
  name: "Vision79 Demo Workspace", address: "Test Address", phone: "000-000-0000",
  email: "visual-qa@example.invalid", logoUrl: "", website: "", currency: "XCD",
  paymentTerms: "14 days", taxRate: 0
};

function dataFor(pathname, role, permissions) {
  const map = {
    "/api/auth/me": {
      id: "qa-operator", name: "Tiquet Visual QA", email: "qa@example.invalid",
      role, account_id: "qa-workspace", permissions
    },
    "/api/settings": settings,
    "/api/jobs": jobs,
    "/api/clients": clients,
    "/api/employees": employees,
    "/api/payroll": [],
    "/api/users": [],
    "/api/industries": [],
    "/api/files": [],
    "/api/payments": payments,
    "/api/payments/summary": {
      received: 100, count: 1, outstandingInvoices: 340
    },
    "/api/team-management-mode": {
      managedByHub: true, hubUrl: "https://hub.v79sl.com"
    }
  };
  return Object.hasOwn(map, pathname) ? map[pathname] : null;
}

async function setup(browser, view, theme, role = "Admin", permissions = []) {
  const context = await browser.newContext({
    viewport: view === "desktop" ? { width: 1440, height: 900 } : { width: 390, height: 844 },
    deviceScaleFactor: 1, colorScheme: theme === "dark" ? "dark" : "light"
  });
  if (theme === "dark") {
    await context.addInitScript(() => localStorage.setItem("v79-tiquet-theme", "dark"));
  }
  const attemptedWrites = [];
  const unexpected = [];
  await context.route("https://**/*", route => route.abort("blockedbyclient"));
  await context.route("**/api/**", async route => {
    const request = route.request();
    const u = new URL(request.url());
    if (request.method() !== "GET") {
      attemptedWrites.push(request.method() + " " + u.pathname);
      return route.fulfill({ status: 405, contentType: "application/json", body: '{"error":"Read-only QA"}' });
    }
    const payload = dataFor(u.pathname, role, permissions);
    if (payload === null) {
      unexpected.push(u.pathname);
      return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"Unmocked QA path"}' });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on("pageerror", err => runtimeErrors.push(err.message));
  return { context, page, attemptedWrites, unexpected, runtimeErrors };
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const screens = [
      { key: "overview", tab: "dashboard", heading: "Service Operations" },
      { key: "jobs", tab: "jobs", heading: "Jobs Pipeline" },
      { key: "invoices", tab: "invoices", heading: "Invoices & Payments" },
      { key: "clients", tab: "clients", heading: "Client Management" }
    ];
    for (const view of ["desktop", "mobile"]) {
      for (const theme of ["light", "dark"]) {
        const qa = await setup(browser, view, theme);
        try {
          for (const screen of screens) {
            await qa.page.goto(base + "/?tab=" + screen.tab, { waitUntil: "networkidle" });
            await qa.page.getByRole("heading", { name: screen.heading, exact: true }).waitFor();
            await qa.page.locator(".v79-tiquet-app").waitFor();
            const actualTheme = await qa.page.locator(".v79-tiquet-app").getAttribute("data-theme");
            assert.equal(actualTheme, theme, "Theme must match selected visual test");
            if (view === "mobile") {
              assert.equal(await qa.page.getByRole("navigation", { name: "Mobile workspace navigation" }).count(), 1);
            }
            const filename = "tiquet-" + screen.key + "-" + view + "-" + theme + ".png";
            await qa.page.screenshot({ path: path.join(output, filename), animations: "disabled" });
            console.log("SCREENSHOT=" + filename);
          }
          assert.deepEqual(qa.attemptedWrites, [], "Visual smoke must never send API writes");
          assert.deepEqual(qa.unexpected, [], "Unexpected API calls must be explicitly reviewed");
          assert.deepEqual(qa.runtimeErrors, [], "Browser must not throw uncaught runtime errors");
        } finally {
          await qa.context.close();
        }
      }
    }
    const restricted = await setup(browser, "mobile", "light", "Staff", ["jobs"]);
    try {
      await restricted.page.goto(base + "/?tab=invoices", { waitUntil: "networkidle" });
      await restricted.page.getByRole("heading", { name: "Jobs Pipeline", exact: true }).waitFor();
      assert.equal(
        await restricted.page.getByRole("navigation", { name: "Mobile workspace navigation" })
          .getByRole("button", { name: "Invoices", exact: true }).count(),
        0, "Role-restricted bottom navigation must not expose Invoices"
      );
      assert.deepEqual(restricted.attemptedWrites, []);
      assert.deepEqual(restricted.runtimeErrors, []);
      console.log("PERMISSION_NAVIGATION=PASS_RESTRICTED_JOB_ONLY");
    } finally {
      await restricted.context.close();
    }
    fs.writeFileSync(path.join(output, "README.txt"),
      "Vision79 Tiquet PR #48 - synthetic browser visual test only\n" +
      "Source commit: " + (process.env.GITHUB_HEAD_SHA || "local") + "\n" +
      "These screenshots render the actual candidate React UI with mocked, synthetic API data.\n" +
      "They are NOT screenshots of a signed-in live environment and do NOT validate Hub SSO, tenant persistence, payments or deployment.\n" +
      "No customer records, real tokens or production services were accessed.\n");
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
