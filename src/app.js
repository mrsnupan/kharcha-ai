require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Trust Railway's proxy (required for correct IP detection and rate limiting)
app.set('trust proxy', 1);

// ──────────────────────────────────────────────────────────
// SECURITY HEADERS (helmet)
// Sets: X-Content-Type-Options, X-Frame-Options, HSTS,
//       Referrer-Policy, X-XSS-Protection, CSP, etc.
// ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'none'"],
      objectSrc:  ["'none'"]
    }
  },
  hsts: {
    maxAge: 31536000,       // 1 year
    includeSubDomains: true,
    preload: true
  }
}));

// ──────────────────────────────────────────────────────────
// HTTPS ENFORCEMENT (production only)
// ──────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
  });
}

// ──────────────────────────────────────────────────────────
// RATE LIMITING
// ──────────────────────────────────────────────────────────

// Global: 200 requests per 15 minutes per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Bahut zyada requests. Thodi der baad try karo.' }
});
app.use(globalLimiter);

// Strict limiter for auth endpoints: 5 per 15 min per phone
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Bahut zyada OTP requests. 15 minutes baad try karo.' }
});

// SMS webhook: 60 per minute per IP
const smsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many SMS requests' }
});

// ──────────────────────────────────────────────────────────
// BODY PARSERS
// Twilio sends form-encoded; Android app sends JSON
// ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '50kb' }));           // prevent huge JSON body
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// ──────────────────────────────────────────────────────────
// REQUEST LOGGER (PII-safe — masks phone numbers and tokens)
// ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const safe = {
    method: req.method,
    path: req.path,
    ip: req.ip?.replace(/\d+$/, 'xxx'),  // mask last IP octet
    ua: (req.headers['user-agent'] || '').slice(0, 60)
  };
  console.log('[Request]', JSON.stringify(safe));
  next();
});

// ──────────────────────────────────────────────────────────
// ROUTES
// ──────────────────────────────────────────────────────────
const whatsappWebhook = require('./webhooks/whatsapp');
const smsWebhook      = require('./webhooks/sms');
const authRoutes      = require('./routes/auth');
const dataRoutes      = require('./routes/data');   // DPDP Act: user data rights

app.use('/webhook/whatsapp', whatsappWebhook);
app.use('/webhook/sms', smsLimiter, smsWebhook);
app.use('/api', authLimiter, authRoutes);
app.use('/user', dataRoutes);

// ──────────────────────────────────────────────────────────
// HEALTH CHECK (no auth needed)
// ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'KharchaAI', timestamp: new Date().toISOString() });
});

// ──────────────────────────────────────────────────────────
// 404
// ──────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ──────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLER — never leak stack traces to client
// ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);         // log detail server-side only
  res.status(500).json({ error: 'Kuch gadbad ho gayi. Thodi der baad try karo.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`KharchaAI running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);

  // Start weekly report cron (checks every hour, sends to users due at that time)
  const { startWeeklyReportCron } = require('./services/weeklyReport');
  startWeeklyReportCron();

  // Start daily reminder cron (EMI, recharge, bill alerts — 8 AM IST)
  const { startReminderCron } = require('./services/reminderCron');
  startReminderCron();
});

module.exports = app;
