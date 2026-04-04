const { validationResult } = require('express-validator');

/**
 * Runs express-validator checks and returns 400 if any fail.
 * Use after a chain of check() calls.
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: errors.array()[0].msg  // return first error in friendly format
    });
  }
  next();
}

/**
 * Mask a phone number for safe logging: +919876543210 → +91XXXXXXX210
 */
function maskPhone(phone) {
  if (!phone || phone.length < 4) return '***';
  return phone.slice(0, 3) + 'X'.repeat(phone.length - 6) + phone.slice(-3);
}

/**
 * Mask a token for safe logging: abcdef1234... → abcd...1234
 */
function maskToken(token) {
  if (!token || token.length < 8) return '***';
  return token.slice(0, 4) + '...' + token.slice(-4);
}

/**
 * Mask an account number: XX1234 → XX1234 (already masked by bank)
 */
function maskAccount(text) {
  // Replace anything that looks like a full account number with masked version
  return text.replace(/\b\d{9,18}\b/g, (match) => {
    return 'XXXX' + match.slice(-4);
  });
}

module.exports = { validate, maskPhone, maskToken, maskAccount };
