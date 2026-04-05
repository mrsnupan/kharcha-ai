/**
 * SMS Parser for Indian bank and UPI messages
 * Extracts: amount, description, transactionType, date, bankRef
 */

// ──────────────────────────────────────────────────────────
// Amount extraction patterns
// ──────────────────────────────────────────────────────────
const AMOUNT_PATTERNS = [
  /(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
  /([\d,]+(?:\.\d{1,2})?)\s*(?:INR|Rs\.?|₹)/i,
  /debited\s+(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
  /credited\s+(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
  /(?:of|for|amount)\s+(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i
];

// ──────────────────────────────────────────────────────────
// Transaction type keywords
// ──────────────────────────────────────────────────────────
const DEBIT_KEYWORDS = [
  'debited', 'debit', 'paid', 'payment', 'purchase', 'withdrawn',
  'trf to', 'transfer to', 'sent to'
];
const CREDIT_KEYWORDS = [
  'credited', 'credit', 'received', 'deposited',
  'trf from', 'transfer from', 'refund'
];

// ──────────────────────────────────────────────────────────
// Date extraction
// ──────────────────────────────────────────────────────────
const DATE_PATTERNS = [
  // DD-MM-YY or DD-MM-YYYY
  /(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/,
  // "on 29 Mar 2026"
  /on\s+(\d{1,2}\s+\w{3}\s+\d{4})/i,
  // "on 29-Mar-26"
  /on\s+(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})/i
];

// ──────────────────────────────────────────────────────────
// Merchant / description extraction per bank
// ──────────────────────────────────────────────────────────
const MERCHANT_PATTERNS = [
  // UPI Info: <merchant>
  /(?:UPI|Info|Ref)\s*[:\-\/]\s*([A-Za-z0-9@.\-_& ]{3,40}?)(?:\s+(?:Ref|A\/c|Avl|Available|on)|\.|$)/i,
  // "towards <merchant>"
  /towards\s+([A-Za-z0-9@.\-_& ]{3,40}?)(?:\s+on\s|\.|$)/i,
  // "trf to <merchant>"
  /trf\s+to\s+([A-Za-z0-9@.\-_& ]{3,40}?)(?:\s+Ref|\s+A\/c|\.|$)/i,
  // "at <merchant>"
  /at\s+([A-Za-z0-9@.\-_& ]{3,40}?)(?:\s+on\s|\.\s|$)/i,
  // "to <merchant> Ref"
  /to\s+([A-Za-z0-9@.\-_& ]{3,40}?)\s+Ref/i
];

// Bank ref number patterns
const REF_PATTERNS = [
  /(?:Ref(?:\.?\s*No\.?|erence)?|txn|Transaction)\s*[:\-]?\s*([A-Za-z0-9]{6,20})/i,
  /UPI\s*Ref\s*[:\-]?\s*([0-9]{10,20})/i
];

// ──────────────────────────────────────────────────────────
// UPI sender patterns (GPay, PhonePe, Paytm)
// ──────────────────────────────────────────────────────────
const UPI_APP_PATTERNS = [
  { pattern: /google\s*pay|gpay/i,    label: 'Google Pay' },
  { pattern: /phonepe/i,              label: 'PhonePe' },
  { pattern: /paytm/i,                label: 'Paytm' },
  { pattern: /amazon\s*pay/i,         label: 'Amazon Pay' },
  { pattern: /bhim/i,                 label: 'BHIM' },
  { pattern: /mobikwik/i,             label: 'MobiKwik' }
];

// ──────────────────────────────────────────────────────────
// Core parser
// ──────────────────────────────────────────────────────────

/**
 * Parse a bank/UPI SMS string.
 * Returns { amount, description, transactionType, transactionDate, bankRef, isValid }
 */
function parseSMS(smsText) {
  if (!smsText || typeof smsText !== 'string') {
    return { isValid: false };
  }

  const text = smsText.trim();

  // ── Amount ──
  let amount = null;
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      amount = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(amount) && amount > 0) break;
    }
  }
  if (!amount) return { isValid: false };

  // ── Transaction type ──
  const lower = text.toLowerCase();
  let transactionType = 'debit'; // default: assume expense
  for (const kw of CREDIT_KEYWORDS) {
    if (lower.includes(kw)) { transactionType = 'credit'; break; }
  }
  for (const kw of DEBIT_KEYWORDS) {
    if (lower.includes(kw)) { transactionType = 'debit'; break; }
  }

  // ── Date ──
  let transactionDate = new Date().toISOString();
  for (const dp of DATE_PATTERNS) {
    const m = text.match(dp);
    if (m) {
      const parsed = new Date(m[1].replace(/-/g, '/'));
      if (!isNaN(parsed)) {
        transactionDate = parsed.toISOString();
        break;
      }
    }
  }

  // ── Merchant / Description ──
  let description = '';

  // Try structured UPI app mention first
  for (const { pattern, label } of UPI_APP_PATTERNS) {
    if (pattern.test(text)) {
      description = label;
      break;
    }
  }

  // Try merchant patterns
  if (!description) {
    for (const mp of MERCHANT_PATTERNS) {
      const m = text.match(mp);
      if (m && m[1]) {
        description = m[1].trim().replace(/\s+/g, ' ');
        // Filter noise
        if (description.length > 2 && !/^(on|at|the|to)$/i.test(description)) {
          break;
        }
        description = '';
      }
    }
  }

  // Fallback: extract account-related label
  if (!description) {
    const acMatch = text.match(/A\/c\s+(?:XX)?(\d{2,6})/i);
    description = acMatch ? `Bank A/c XX${acMatch[1]}` : 'Bank Transaction';
  }

  // Clean up description
  description = description
    .replace(/[^A-Za-z0-9 @&\-_.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // ── Bank Reference ──
  let bankRef = null;
  for (const rp of REF_PATTERNS) {
    const m = text.match(rp);
    if (m) { bankRef = m[1]; break; }
  }

  return {
    isValid: true,
    amount,
    description,
    transactionType,
    transactionDate,
    bankRef
  };
}

/**
 * Determine if SMS looks like a bank/financial message
 */
function isBankSMS(smsText) {
  if (!smsText) return false;
  const lower = smsText.toLowerCase();
  const bankKeywords = [
    'debited', 'credited', 'a/c', 'account', 'balance', 'upi', 'neft', 'imps',
    'bank', 'card', 'transaction', 'inr', 'rs.', '₹', 'avl bal', 'available balance'
  ];
  return bankKeywords.some(kw => lower.includes(kw));
}

// ──────────────────────────────────────────────────────────
// Income detection — is this credit SMS a salary/income?
// Filters out small UPI credits (friend payments, refunds < ₹1000)
// ──────────────────────────────────────────────────────────
const INCOME_KEYWORDS = [
  'salary', 'sal ', 'payroll', 'stipend',           // Salary
  'neft', 'rtgs',                                    // Bank transfers (usually income)
  'freelance', 'invoice', 'project pay',             // Freelance
  'rent received', 'house rent',                     // Rent income
  'dividend', 'interest credit', 'mf redemption',   // Investment
  'commission', 'incentive', 'bonus',                // Business
  'cashback', 'refund', 'reversal'                   // Refunds
];

const SKIP_CREDIT_KEYWORDS = [
  'otp', 'tpin', 'linked', 'registered',            // Non-transaction SMS
  'offer', 'discount', 'reward points'              // Marketing SMS
];

/**
 * Check if a credit SMS represents income (salary, freelance, etc.)
 * Returns true if it should be logged as income.
 */
function isIncomeSMS(smsText, amount) {
  if (!smsText) return false;
  const lower = smsText.toLowerCase();

  // Skip obvious non-income SMS
  if (SKIP_CREDIT_KEYWORDS.some(kw => lower.includes(kw))) return false;

  // Explicit income keywords → always log
  if (INCOME_KEYWORDS.some(kw => lower.includes(kw))) return true;

  // Large credit via NEFT/RTGS (>= ₹5000) → likely income
  if (amount >= 5000 && (lower.includes('neft') || lower.includes('rtgs') || lower.includes('imps'))) return true;

  // Very large UPI credit (>= ₹10000) → log as transfer income
  if (amount >= 10000 && lower.includes('upi')) return true;

  return false;
}

module.exports = { parseSMS, isBankSMS, isIncomeSMS };
