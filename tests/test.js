/**
 * KharchaAI — Offline unit tests (no API keys needed)
 * Run: node tests/test.js
 */

// ── Mini test harness ──
let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}
function assertEqual(a, b) {
  if (a !== b) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ─────────────────────────────────────────
// 1. SMS Parser tests
// ─────────────────────────────────────────
console.log('\n📱 SMS Parser Tests');
const { parseSMS, isBankSMS } = require('../src/services/parser');

test('SBI UPI debit SMS', () => {
  const sms = "Your A/c XX1234 debited INR 450.00 on 29-03-26. Info: UPI/Zomato. Avl Bal: INR 45,230.00";
  const r = parseSMS(sms);
  assert(r.isValid, 'Should be valid');
  assertEqual(r.amount, 450);
  assertEqual(r.transactionType, 'debit');
  assert(r.description.toLowerCase().includes('zomato') || r.description.length > 0, 'Should have description');
});

test('UPI transfer to vegetable market', () => {
  const sms = "Dear UPI user, Rs.300.00 debited from a/c XX5678 on 29-03-26 trf to VEGETABLE MARKET Ref No 123456";
  const r = parseSMS(sms);
  assert(r.isValid, 'Should be valid');
  assertEqual(r.amount, 300);
  assertEqual(r.transactionType, 'debit');
  assert(r.description.toLowerCase().includes('vegetable') || r.description.length > 0, 'Should have merchant');
});

test('HDFC utility bill payment', () => {
  const sms = "HDFC Bank: Rs.2400 debited from a/c XX9012 towards BESCOM on 29-03-26. Available balance Rs.38,450";
  const r = parseSMS(sms);
  assert(r.isValid, 'Should be valid');
  assertEqual(r.amount, 2400);
  assertEqual(r.transactionType, 'debit');
});

test('Credit transaction ignored', () => {
  const sms = "Your A/c XX1234 credited INR 5000.00 on 29-03-26. Ref: SALARY";
  const r = parseSMS(sms);
  assert(r.isValid, 'Should be valid');
  assertEqual(r.transactionType, 'credit');
});

test('Large amount with commas', () => {
  const sms = "SBI: INR 1,25,000.00 debited from A/c XX7890 for Home Loan EMI. Ref: 98765432";
  const r = parseSMS(sms);
  assert(r.isValid, 'Should be valid');
  assertEqual(r.amount, 125000);
});

test('isBankSMS rejects non-bank SMS', () => {
  assert(!isBankSMS("Hey, are you coming tonight?"), 'Should reject non-bank SMS');
});

test('isBankSMS accepts bank SMS', () => {
  assert(isBankSMS("Your A/c XX1234 debited INR 450.00"), 'Should accept bank SMS');
});

// ─────────────────────────────────────────
// 2. Category detection tests
// ─────────────────────────────────────────
console.log('\n🛒 Category Detection Tests');
const { detectCategory, getCategoryById } = require('../src/utils/categories');

test('Zomato → food', () => {
  assertEqual(detectCategory('Zomato Order').id, 'food');
});
test('Petrol → transport', () => {
  assertEqual(detectCategory('Petrol pump').id, 'transport');
});
test('BESCOM → utilities', () => {
  assertEqual(detectCategory('BESCOM electricity bill').id, 'utilities');
});
test('Apollo Pharmacy → healthcare', () => {
  assertEqual(detectCategory('Apollo pharmacy').id, 'healthcare');
});
test('Blinkit → grocery', () => {
  assertEqual(detectCategory('Blinkit order').id, 'grocery');
});
test('School fees → education', () => {
  assertEqual(detectCategory('school fees').id, 'education');
});
test('Maid salary → household', () => {
  assertEqual(detectCategory('bai ko salary').id, 'household');
});
test('Unknown → other', () => {
  assertEqual(detectCategory('random thing xyz123').id, 'other');
});

// ─────────────────────────────────────────
// 3. Formatter tests
// ─────────────────────────────────────────
console.log('\n📊 Formatter Tests');
const { formatAmount, formatExpenseConfirmation, formatBudgetAlert } = require('../src/utils/formatter');

test('Format amount 450', () => {
  assertEqual(formatAmount(450), '₹450');
});
test('Format amount 125000', () => {
  assertEqual(formatAmount(125000), '₹1,25,000');
});
test('Budget alert at 80%', () => {
  const msg = formatBudgetAlert('Grocery', '🛒', 6400, 8000, 80);
  assert(msg.includes('80%') || msg.includes('⚠️'), 'Should have warning indicator');
  assert(msg.includes('₹1,600'), 'Should show remaining');
});
test('Budget alert at 100%', () => {
  const msg = formatBudgetAlert('Grocery', '🛒', 8450, 8000, 106);
  assert(msg.includes('🚨'), 'Should have red alert');
  assert(msg.includes('exceeded'), 'Should say exceeded');
});
test('Expense confirmation format', () => {
  const exp = { amount: 450, category: 'food', description: 'Zomato' };
  const msg = formatExpenseConfirmation(exp, 'sms');
  assert(msg.includes('₹450'), 'Should include amount');
  assert(msg.includes('Zomato'), 'Should include description');
});

// ─────────────────────────────────────────
// 4. Summary
// ─────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
