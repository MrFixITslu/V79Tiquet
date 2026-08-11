/**
 * server/email.js — Transactional email via Nodemailer
 *
 * Reads SMTP settings from environment variables. If SMTP is not
 * configured the functions still resolve successfully (emails are
 * logged at INFO level so the API still works without email).
 *
 * Required env vars (set in .env):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, APP_BASE_URL
 */

import nodemailer from 'nodemailer';
import { logger } from './logger.js';

const SMTP_HOST    = process.env.SMTP_HOST;
const SMTP_PORT    = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER    = process.env.SMTP_USER;
const SMTP_PASS    = process.env.SMTP_PASS;
const SMTP_FROM    = process.env.SMTP_FROM || '"V79 Tick-It" <noreply@v79tickit.com>';
const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const isSmtpConfigured = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

let transporter = null;

if (isSmtpConfigured) {
    transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        // Sensible timeouts so one bad SMTP call doesn't hang the API
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout:   15_000,
    });

    // Verify connection at startup (non-fatal)
    transporter.verify().then(() => {
        logger.info('SMTP connection verified');
    }).catch(err => {
        logger.warn('SMTP connection verification failed', { error: err.message });
    });
} else {
    logger.info('SMTP not configured — emails will be logged but not delivered');
}

// ── Internal send helper ──────────────────────────────────────────────────────

async function send(to, subject, html) {
    if (!isSmtpConfigured) {
        logger.info('Email skipped (SMTP not configured)', { to, subject });
        return { success: true, skipped: true, previewUrl: null };
    }

    try {
        const info = await transporter.sendMail({ from: SMTP_FROM, to, subject, html });
        const previewUrl = nodemailer.getTestMessageUrl(info) || null;
        logger.info('Email sent', { to, subject, messageId: info.messageId });
        return { success: true, previewUrl };
    } catch (err) {
        logger.error('Email send failed', { to, subject, error: err.message });
        return { success: false, error: err.message };
    }
}

// ── Email templates ───────────────────────────────────────────────────────────

/**
 * Send a client portal access link.
 * Called when the agent clicks "Send Portal Link" on a job.
 */
export async function sendPortalLink(clientEmail, jobTitle, secureToken) {
    const portalUrl = `${APP_BASE_URL}/portal/${secureToken}`;
    const subject   = `Your Job Portal: ${jobTitle}`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr><td style="background:#1e293b;padding:28px 36px">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600">V79 Tick-It</h1>
        </td></tr>
        <tr><td style="padding:36px">
          <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px">Your Job Portal is Ready</h2>
          <p style="margin:0 0 20px;color:#475569;line-height:1.6">
            You can now view real-time status updates and communicate with us for:
          </p>
          <p style="margin:0 0 28px;font-weight:600;color:#1e293b;font-size:16px">${escapeHtml(jobTitle)}</p>
          <a href="${portalUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
            View Job Portal →
          </a>
          <p style="margin:24px 0 0;color:#94a3b8;font-size:13px">
            Or copy this link: <span style="color:#3b82f6">${portalUrl}</span>
          </p>
        </td></tr>
        <tr><td style="background:#f1f5f9;padding:20px 36px;color:#94a3b8;font-size:12px">
          This is an automated message from V79 Tick-It. Please do not reply to this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    return send(clientEmail, subject, html);
}

/**
 * Send a password reset link to a user (agent/admin account, not a client
 * portal). Called from POST /api/auth/forgot-password. The token itself is
 * generated and hashed for storage by the caller — this function only
 * builds and sends the email.
 */
export async function sendPasswordReset(userEmail, resetToken) {
    const resetUrl = `${APP_BASE_URL}/reset-password/${resetToken}`;
    const subject  = 'Reset your V79 TIQUET password';

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr><td style="background:#1e293b;padding:28px 36px">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600">V79 Tick-It</h1>
        </td></tr>
        <tr><td style="padding:36px">
          <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px">Reset your password</h2>
          <p style="margin:0 0 20px;color:#475569;line-height:1.6">
            We received a request to reset the password on your account. This link expires in 30 minutes.
            If you didn't request this, you can safely ignore this email — your password won't change.
          </p>
          <a href="${resetUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
            Reset Password →
          </a>
          <p style="margin:24px 0 0;color:#94a3b8;font-size:13px">
            Or copy this link: <span style="color:#3b82f6">${resetUrl}</span>
          </p>
        </td></tr>
        <tr><td style="background:#f1f5f9;padding:20px 36px;color:#94a3b8;font-size:12px">
          This is an automated message from V79 Tick-It. Please do not reply to this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    return send(userEmail, subject, html);
}

/**
 * Notify the client when their job status changes.
 * Called automatically on job PUT if the status field changed.
 */
export async function sendStatusUpdate(clientEmail, jobTitle, newStatus, secureToken) {
    const portalUrl = `${APP_BASE_URL}/portal/${secureToken}`;

    const STATUS_LABELS = {
        request:      'Request Received',
        estimation:   'Estimation In Progress',
        'in-progress':'Work In Progress',
        review:       'Ready for Review',
        invoiced:     'Invoice Sent',
        completed:    'Completed',
    };
    const label = STATUS_LABELS[newStatus] || newStatus;

    const STATUS_COLOURS = {
        request:      '#6366f1',
        estimation:   '#f59e0b',
        'in-progress':'#3b82f6',
        review:       '#8b5cf6',
        invoiced:     '#10b981',
        completed:    '#059669',
    };
    const badgeColour = STATUS_COLOURS[newStatus] || '#64748b';

    const subject = `Job Update: ${jobTitle} — ${label}`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr><td style="background:#1e293b;padding:28px 36px">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600">V79 Tick-It</h1>
        </td></tr>
        <tr><td style="padding:36px">
          <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px">Job Status Update</h2>
          <p style="margin:0 0 8px;color:#475569">Your job:</p>
          <p style="margin:0 0 20px;font-weight:600;color:#1e293b;font-size:16px">${escapeHtml(jobTitle)}</p>
          <p style="margin:0 0 28px;color:#475569">has been updated to:</p>
          <span style="display:inline-block;background:${badgeColour};color:#ffffff;padding:8px 18px;border-radius:20px;font-size:14px;font-weight:600">
            ${escapeHtml(label)}
          </span>
          <p style="margin:28px 0 0">
            <a href="${portalUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">
              View on Portal →
            </a>
          </p>
        </td></tr>
        <tr><td style="background:#f1f5f9;padding:20px 36px;color:#94a3b8;font-size:12px">
          This is an automated message from V79 Tick-It. Please do not reply to this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    return send(clientEmail, subject, html);
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Merge {{field}} tokens into a PLAIN TEXT template (subject or message
 * body — see plainTextToHtml/wrapEmailShell below for how the body becomes
 * an actual email). Deliberately does NOT escape here — this template is
 * plain text the admin typed, not HTML, so there's nothing to break out of
 * yet. Escaping happens exactly once, in plainTextToHtml, right before the
 * text is placed inside markup.
 */
export function renderPlainTemplate(template, vars) {
    return String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
        return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : match;
    });
}

/**
 * Turns admin-typed plain text into safe email HTML: escapes everything
 * (so there's no HTML-injection surface at all — unlike a rich-text editor,
 * this never trusts stored markup), then auto-links bare URLs, then relies
 * on `white-space: pre-line` to preserve the paragraph/line breaks the
 * admin actually typed without needing to hand-split into <p>/<br> tags.
 */
export function plainTextToHtml(text) {
    const escaped = escapeHtml(text);
    const linked = escaped.replace(
        /(https?:\/\/[^\s<]+)/g,
        (url) => {
            // Don't swallow trailing punctuation into the link — "at
            // {{site_url}}." (a period ending the sentence) was turning into
            // a literal link to ".../duckdns.org." with the period as part
            // of the URL, which 404s for most sites and just looks wrong.
            const trailingPunct = url.match(/[.,;:!?)\]}"']+$/)?.[0] || '';
            const cleanUrl = trailingPunct ? url.slice(0, -trailingPunct.length) : url;
            return `<a href="${cleanUrl}" style="color:#3b82f6;text-decoration:underline">${cleanUrl}</a>${trailingPunct}`;
        }
    );
    return `<div style="color:#475569;line-height:1.6;white-space:pre-line">${linked}</div>`;
}

/**
 * Fixed branded shell (header bar, card, footer) that every templated email
 * renders inside. This part is never admin-edited — only the subject and
 * plain-text message body are — so there's no way for a template edit to
 * break the layout, lose the footer/contact info, or omit the opt-in link.
 */
export function wrapEmailShell({ companyName, companyAddress, companyPhone, companyEmail, bodyHtml, ctaHtml }) {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr><td style="background:#1e293b;padding:28px 36px">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600">${escapeHtml(companyName || '')}</h1>
        </td></tr>
        <tr><td style="padding:36px">
          ${bodyHtml}
          ${ctaHtml ? `<div style="margin-top:24px">${ctaHtml}</div>` : ''}
        </td></tr>
        <tr><td style="background:#f1f5f9;padding:20px 36px;color:#94a3b8;font-size:12px">
          ${escapeHtml(companyName || '')} &middot; ${escapeHtml(companyAddress || '')} &middot; ${escapeHtml(companyPhone || '')} &middot; ${escapeHtml(companyEmail || '')}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Full pipeline: plain-text template + merge vars -> safe HTML email, ready
 * to send. `ctaHtml`, if given, is fixed markup (not admin-typed) — e.g. the
 * "Yes, send me the newsletter" button on the welcome email.
 */
export function renderEmailFromPlainTemplate(subjectTemplate, bodyTemplate, vars, { ctaHtml } = {}) {
    const subject = renderPlainTemplate(subjectTemplate, vars).replace(/[\r\n]+/g, ' ').trim();
    const bodyHtml = plainTextToHtml(renderPlainTemplate(bodyTemplate, vars));
    const html = wrapEmailShell({
        companyName: vars.company_name,
        companyAddress: vars.company_address,
        companyPhone: vars.company_phone,
        companyEmail: vars.company_email,
        bodyHtml,
        ctaHtml,
    });
    return { subject, html };
}

/**
 * Send an already-rendered template. Thin wrapper around the internal
 * `send()` helper so callers (welcome email, newsletter broadcast) don't
 * need their own copy of the transporter/logging logic.
 */
export async function sendTemplated(to, subject, html) {
    return send(to, subject, html);
}
