const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { body } = require('express-validator');
const supabase = require('../models/db');
const { findOrCreateUser } = require('../models/user');
const { sendMessage } = require('../services/whatsapp');
const { validate, maskPhone } = require('../middleware/validate');

const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS   = 3;
const TOKEN_EXPIRY_DAYS  = 30;

// ──────────────────────────────────────────────────────────
// POST /api/register
// Sends 6-digit OTP to user's WhatsApp
// ──────────────────────────────────────────────────────────
router.post('/register',
  body('phone')
    .notEmpty().withMessage('Phone number chahiye')
    .custom(v => isValidIndianPhone(v)).withMessage('Valid Indian mobile number daalo'),
  validate,
  async (req, res) => {
    const phone = normalizePhone(req.body.phone);

    // Delete any existing OTP for this phone
    await supabase.from('otp_store').delete().eq('phone', phone).catch(() => {});

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = hashValue(otp); // NEVER store OTP plaintext
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

    const { error: insertErr } = await supabase
      .from('otp_store')
      .insert({ phone, otp_hash: otpHash, expires_at: expiresAt, attempts: 0 });

    if (insertErr) {
      console.error('[Auth] OTP store error:', insertErr.message);
      return res.status(500).json({ error: 'Server error. Thodi der baad try karo.' });
    }

    // Send OTP via WhatsApp
    const whatsappNumber = `whatsapp:${phone}`;
    const message =
      `🔐 *KharchaAI Verification*\n\n` +
      `Aapka OTP: *${otp}*\n\n` +
      `Valid for ${OTP_EXPIRY_MINUTES} minutes.\n` +
      `Kisi ke saath share mat karo. Hum kabhi OTP nahi maangenge.`;

    try {
      await sendMessage(whatsappNumber, message);
      // Log masked phone — NEVER log OTP
      console.log(`[Auth] OTP sent to ${maskPhone(phone)}`);
      res.json({ success: true });
    } catch (err) {
      console.error('[Auth] WhatsApp OTP send failed:', err.message);
      res.status(500).json({ error: 'OTP bhejne mein problem. Thodi der baad try karo.' });
    }
  }
);

// ──────────────────────────────────────────────────────────
// POST /api/verify
// Verifies OTP, returns Bearer token
// ──────────────────────────────────────────────────────────
router.post('/verify',
  body('phone').notEmpty().custom(v => isValidIndianPhone(v)).withMessage('Invalid phone'),
  body('otp').isLength({ min: 6, max: 6 }).isNumeric().withMessage('6-digit OTP daalo'),
  validate,
  async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const otp   = req.body.otp.trim();

    const { data: stored, error: fetchErr } = await supabase
      .from('otp_store')
      .select('*')
      .eq('phone', phone)
      .single();

    if (fetchErr || !stored) {
      return res.status(400).json({ error: 'OTP nahi mila. Pehle /api/register call karo.' });
    }

    // Check expiry
    if (new Date() > new Date(stored.expires_at)) {
      await supabase.from('otp_store').delete().eq('phone', phone).catch(() => {});
      return res.status(400).json({ error: 'OTP expire ho gaya. Dobara bhijwao.' });
    }

    // Increment attempt count
    const newAttempts = (stored.attempts || 0) + 1;
    if (newAttempts > MAX_OTP_ATTEMPTS) {
      await supabase.from('otp_store').delete().eq('phone', phone).catch(() => {});
      return res.status(429).json({ error: 'Zyada galat attempts. Dobara OTP maango.' });
    }
    await supabase.from('otp_store').update({ attempts: newAttempts }).eq('phone', phone).catch(() => {});

    // Verify OTP hash
    if (hashValue(otp) !== stored.otp_hash) {
      const remaining = MAX_OTP_ATTEMPTS - newAttempts;
      return res.status(400).json({
        error: `OTP galat hai. ${remaining > 0 ? remaining + ' try bacha hai.' : 'Dobara OTP maango.'}`
      });
    }

    // OTP correct — delete it immediately (one-time use)
    await supabase.from('otp_store').delete().eq('phone', phone).catch(() => {});

    // Find or create user
    const user = await findOrCreateUser(`whatsapp:${phone}`).catch(() => null);
    if (!user) {
      return res.status(500).json({ error: 'Account create karne mein problem. Dobara try karo.' });
    }

    // Generate cryptographically secure token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashValue(token);
    const tokenExpiry = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { error: tokenErr } = await supabase
      .from('users')
      .update({ device_token: tokenHash, token_expires_at: tokenExpiry })
      .eq('id', user.id);

    if (tokenErr) {
      console.error('[Auth] Token save error:', tokenErr.message);
      return res.status(500).json({ error: 'Token save karne mein problem.' });
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      action: 'login',
      meta: { phone: maskPhone(phone) }
    }).catch(() => {});

    // Welcome message
    const welcomeMsg =
      `🎉 *KharchaAI pe swagat hai!*\n\n` +
      `Ab:\n` +
      `• "chai 30" likhke kharcha daalo\n` +
      `• Bank SMS automatically track hoga\n` +
      `• "help" likhne pe poora menu milega 😊`;
    sendMessage(`whatsapp:${phone}`, welcomeMsg).catch(() => {});

    console.log(`[Auth] Login success: ${maskPhone(phone)}`);
    res.json({ success: true, token, name: user.name || null });
  }
);

// ──────────────────────────────────────────────────────────
// Exported helper: look up user by device token
// Used in SMS webhook to authenticate Android app requests
// ──────────────────────────────────────────────────────────
async function getUserByToken(token) {
  if (!token) return null;
  const tokenHash = hashValue(token);

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('device_token', tokenHash)
    .single();

  if (error || !data) return null;

  // Check token expiry
  if (data.token_expires_at && new Date() > new Date(data.token_expires_at)) {
    console.warn(`[Auth] Expired token used for user ${data.id}`);
    return null;
  }

  return data;
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────
function hashValue(val) {
  return crypto.createHash('sha256').update(val).digest('hex');
}

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (phone.startsWith('+')) return phone.replace(/\s/g, '');
  return `+${digits}`;
}

function isValidIndianPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  const core = digits.startsWith('91') ? digits.slice(2)
    : digits.startsWith('0') ? digits.slice(1)
    : digits;
  return core.length === 10 && /^[6-9]/.test(core);
}

module.exports = router;
module.exports.getUserByToken = getUserByToken;
