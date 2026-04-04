/**
 * DPDP Act 2023 (Digital Personal Data Protection) — User Data Rights
 *
 * Required endpoints under India's DPDP Act:
 *   GET  /user/data     — Right to Access: export all personal data
 *   POST /user/delete   — Right to Erasure: delete all user data
 *   POST /user/consent  — Consent management
 *
 * These must be fulfilled within 30 days per the Act.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../models/db');
const { getUserByToken } = require('./auth');
const { maskPhone } = require('../middleware/validate');

// ──────────────────────────────────────────────────────────
// Auth middleware — requires Bearer token
// ──────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const user = await getUserByToken(token).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  req.user = user;
  next();
}

// ──────────────────────────────────────────────────────────
// GET /user/data  — Right to Access (DPDP Section 11)
// Returns all personal data in JSON format
// ──────────────────────────────────────────────────────────
router.get('/data', requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const [expenses, budgets] = await Promise.all([
      supabase.from('expenses').select('*').eq('user_id', userId),
      supabase.from('budgets').select('*').eq('user_id', userId)
    ]);

    const userData = {
      exported_at: new Date().toISOString(),
      user: {
        id: userId,
        whatsapp_number: maskPhone(req.user.whatsapp_number),
        name: req.user.name,
        created_at: req.user.created_at
      },
      expenses: expenses.data || [],
      budgets: budgets.data || []
    };

    // Audit log
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: 'data_export',
      ip_hash: crypto.createHash('sha256').update(req.ip || '').digest('hex')
    }).catch(() => {});

    res.json(userData);
  } catch (err) {
    console.error('[Data] Export error:', err.message);
    res.status(500).json({ error: 'Data export failed. Contact support.' });
  }
});

// ──────────────────────────────────────────────────────────
// POST /user/delete  — Right to Erasure (DPDP Section 12)
// Schedules deletion of all user data within 30 days
// ──────────────────────────────────────────────────────────
router.post('/delete', requireAuth, async (req, res) => {
  const userId = req.user.id;

  // Check if already requested
  const { data: existing } = await supabase
    .from('deletion_requests')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .single();

  if (existing) {
    return res.json({
      message: 'Deletion request already submitted. Will be completed within 30 days.'
    });
  }

  // Log the request
  await supabase.from('deletion_requests').insert({ user_id: userId }).catch(() => {});
  await supabase.from('audit_logs').insert({
    user_id: userId,
    action: 'data_delete_request',
    ip_hash: crypto.createHash('sha256').update(req.ip || '').digest('hex')
  }).catch(() => {});

  // Mark deletion requested on user record
  await supabase.from('users')
    .update({ data_deletion_requested_at: new Date().toISOString() })
    .eq('id', userId)
    .catch(() => {});

  // Revoke token immediately
  await supabase.from('users')
    .update({ device_token: null, token_expires_at: null })
    .eq('id', userId)
    .catch(() => {});

  console.log(`[DPDP] Data deletion requested for user ${userId}`);

  res.json({
    success: true,
    message: 'Aapka data deletion request receive hua. 30 din mein sabh data delete ho jayega.'
  });
});

// ──────────────────────────────────────────────────────────
// POST /user/consent  — Consent management (DPDP Section 6)
// ──────────────────────────────────────────────────────────
router.post('/consent', requireAuth, async (req, res) => {
  const { action, purpose } = req.body;
  const userId = req.user.id;

  const validActions  = ['given', 'withdrawn'];
  const validPurposes = ['expense_tracking', 'sms_processing', 'analytics'];

  if (!validActions.includes(action) || !validPurposes.includes(purpose)) {
    return res.status(400).json({ error: 'Invalid action or purpose' });
  }

  await supabase.from('consent_log').insert({
    user_id: userId,
    action,
    purpose,
    version: process.env.PRIVACY_POLICY_VERSION || '1.0'
  }).catch(() => {});

  if (action === 'given') {
    await supabase.from('users')
      .update({ consent_given_at: new Date().toISOString() })
      .eq('id', userId)
      .catch(() => {});
  }

  res.json({ success: true });
});

module.exports = router;
