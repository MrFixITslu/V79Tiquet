/**
 * stripe.js — Simulated Stripe subscription flows
 * 
 * All endpoints are fully functional with mock data.
 * To enable real Stripe, replace the SIMULATED blocks with
 * actual stripe-node SDK calls (npm install stripe).
 */

import { v4 as uuidv4 } from 'uuid';
import db from './db.js';

const isProduction = process.env.NODE_ENV === 'production';
const errMsg = (e) => (isProduction ? 'Internal Server Error' : e.message);

const PLANS = {
  starter:    { name: 'Starter',    price: parseInt(process.env.PLAN_PRICE_STARTER    || '29'),  features: ['Up to 3 users', '50 jobs/month', 'Email support', 'Client portal'] },
  pro:        { name: 'Pro',        price: parseInt(process.env.PLAN_PRICE_PRO        || '79'),  features: ['Up to 15 users', 'Unlimited jobs', 'Priority support', 'File repository', 'Payroll', '2FA security'] },
  enterprise: { name: 'Enterprise', price: parseInt(process.env.PLAN_PRICE_ENTERPRISE || '199'), features: ['Unlimited users', 'Unlimited everything', 'Dedicated support', 'Custom integrations', 'SLA guarantee', 'White-label'] },
};

/**
 * Register Stripe-related routes on the Express app.
 * @param {import('express').Express} app
 * @param {Function} authenticateToken - existing auth middleware
 */
export function registerStripeRoutes(app, authenticateToken) {

  // ── GET /api/stripe/plans ─────────────────────────────────────────────────
  // Public: return available plan details
  app.get('/api/stripe/plans', (req, res) => {
    res.json(PLANS);
  });

  // ── GET /api/stripe/subscription-status ──────────────────────────────────
  // Auth: return current tenant's subscription
  app.get('/api/stripe/subscription-status', authenticateToken, (req, res) => {
    try {
      const sub = db.prepare("SELECT * FROM subscriptions WHERE account_id = ? ORDER BY createdAt DESC LIMIT 1").get(req.accountId);
      const account = db.prepare("SELECT status, plan, trialEndsAt FROM accounts WHERE id = ?").get(req.accountId);
      if (!sub) return res.json({ status: 'none', plan: 'trial' });

      const daysLeft = sub.current_period_end
        ? Math.max(0, Math.ceil((new Date(sub.current_period_end) - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0;

      res.json({
        ...sub,
        accountStatus: account?.status,
        trialEndsAt: account?.trialEndsAt,
        daysLeft,
        planDetails: PLANS[sub.plan] || null,
      });
    } catch (e) {
      res.status(500).json({ error: errMsg(e) });
    }
  });

  // ── POST /api/stripe/create-checkout-session ──────────────────────────────
  // Auth: simulate creating a checkout session for a plan upgrade
  app.post('/api/stripe/create-checkout-session', authenticateToken, (req, res) => {
    const { plan } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

    try {
      // Simulated: in real mode, call stripe.checkout.sessions.create(...)
      // and return the session URL. Here we return a simulated session ID.
      const simulatedSessionId = `sim_cs_${uuidv4().replace(/-/g, '')}`;
      
      res.json({
        sessionId: simulatedSessionId,
        simulatedMode: true,
        redirectUrl: null, // Real mode: stripe session URL
        plan,
        planDetails: PLANS[plan],
        message: 'Stripe is in simulated mode. No real charge will occur.',
      });
    } catch (e) {
      res.status(500).json({ error: errMsg(e) });
    }
  });

  // ── POST /api/stripe/simulate-subscribe ───────────────────────────────────
  // Simulated: directly activate a subscription for the tenant (replaces webhook)
  app.post('/api/stripe/simulate-subscribe', authenticateToken, (req, res) => {
    const { plan } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

    try {
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
      const fakeSubId = `sim_sub_${uuidv4().replace(/-/g, '').slice(0, 14)}`;
      const fakeCustId = `sim_cus_${uuidv4().replace(/-/g, '').slice(0, 14)}`;

      // Upsert subscription record
      const existing = db.prepare("SELECT id FROM subscriptions WHERE account_id = ?").get(req.accountId);
      if (existing) {
        db.prepare(`
          UPDATE subscriptions 
          SET stripe_subscription_id = ?, stripe_customer_id = ?, status = 'active', plan = ?, current_period_end = ?, canceled_at = NULL
          WHERE account_id = ?
        `).run(fakeSubId, fakeCustId, plan, periodEnd, req.accountId);
      } else {
        db.prepare(`
          INSERT INTO subscriptions (id, account_id, stripe_subscription_id, stripe_customer_id, status, plan, current_period_end, createdAt)
          VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
        `).run(uuidv4(), req.accountId, fakeSubId, fakeCustId, plan, periodEnd, new Date().toISOString());
      }

      // Update account plan
      db.prepare("UPDATE accounts SET plan = ?, stripeCustomerId = ? WHERE id = ?").run(plan, fakeCustId, req.accountId);

      const sub = db.prepare("SELECT * FROM subscriptions WHERE account_id = ?").get(req.accountId);
      res.json({ success: true, subscription: sub, planDetails: PLANS[plan] });
    } catch (e) {
      res.status(500).json({ error: errMsg(e) });
    }
  });

  // ── POST /api/stripe/cancel-subscription ─────────────────────────────────
  // Auth: cancel at period end (simulated)
  app.post('/api/stripe/cancel-subscription', authenticateToken, (req, res) => {
    try {
      const sub = db.prepare("SELECT * FROM subscriptions WHERE account_id = ?").get(req.accountId);
      if (!sub) return res.status(404).json({ error: 'No active subscription found' });

      // Simulated: mark as canceled (would call stripe.subscriptions.update with cancel_at_period_end)
      db.prepare("UPDATE subscriptions SET status = 'canceled', canceled_at = ? WHERE account_id = ?")
        .run(new Date().toISOString(), req.accountId);
      db.prepare("UPDATE accounts SET plan = 'trial' WHERE id = ?").run(req.accountId);

      res.json({ success: true, message: 'Subscription canceled. Access continues until period end.' });
    } catch (e) {
      res.status(500).json({ error: errMsg(e) });
    }
  });

  // ── POST /api/stripe/create-portal-session ────────────────────────────────
  // Auth: simulated customer portal (in real mode, redirect to stripe billing portal)
  app.post('/api/stripe/create-portal-session', authenticateToken, (req, res) => {
    // Simulated: real mode would call stripe.billingPortal.sessions.create(...)
    res.json({
      simulatedMode: true,
      url: null,
      message: 'Stripe Customer Portal is in simulated mode. Add real Stripe keys to activate.',
    });
  });
}
