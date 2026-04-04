const twilio = require('twilio');

/**
 * Twilio webhook signature verification middleware.
 *
 * Twilio signs every request with HMAC-SHA1 using your Auth Token.
 * If the signature doesn't match, the request is forged — reject it.
 *
 * Without this, anyone can POST fake WhatsApp messages impersonating
 * any user and log fraudulent expenses.
 *
 * Docs: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
function twilioValidate(req, res, next) {
  // Skip validation if explicitly disabled (sandbox testing)
  if (process.env.SKIP_TWILIO_VALIDATION === 'true') {
    return next();
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error('[TwilioValidate] TWILIO_AUTH_TOKEN not set');
    return res.status(500).send('Server misconfigured');
  }

  const signature  = req.headers['x-twilio-signature'] || '';
  const webhookUrl = `${process.env.BASE_URL || `https://${req.headers.host}`}${req.originalUrl}`;

  const isValid = twilio.validateRequest(authToken, signature, webhookUrl, req.body);

  if (!isValid) {
    console.warn('[TwilioValidate] Invalid signature from', req.ip);
    return res.status(403).send('Forbidden');
  }

  next();
}

module.exports = twilioValidate;
