const express = require('express');
const router = express.Router();
const supabase = require('../models/db');
const { parseSMS, isBankSMS, isIncomeSMS, isRechargeSMS, parseRechargeSMS } = require('../services/parser');
const { detectCategory } = require('../utils/categories');
const { logExpense } = require('../services/expenses');
const { logIncome, detectIncomeCategory } = require('../models/income');
const { sendMessage } = require('../services/whatsapp');
const { getUserByToken } = require('../routes/auth');
const { maskPhone, maskAccount } = require('../middleware/validate');
const { detectEmiFromSMS, inferEmiName, addEmi, scheduleEmiReminder } = require('../models/emi');
const { addRechargeReminder } = require('../services/reminderCron');

/**
 * POST /webhook/sms
 *
 * Receives forwarded bank SMS from the KharchaAI Android companion app.
 *
 * Body (JSON):
 * {
 *   "token":       "hex-token-from-app-registration",
 *   "message":     "Your A/c XX1234 debited INR 450...",
 *   "from":        "HDFCBK",          // SMS sender ID
 *   "received_at": 1711700000000      // epoch ms (optional)
 * }
 *
 * No manual configuration needed — token is set automatically during
 * app registration (OTP flow). User never sees this.
 */
router.post('/', async (req, res) => {
  res.status(200).end(); // Acknowledge immediately — never block the app

  const { message, from: senderId, received_at } = req.body;
  const rawSMS = message || '';

  if (!rawSMS) {
    console.warn('[SMS webhook] Empty message body');
    return;
  }

  // ── Token auth via Authorization: Bearer header ──
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    console.warn('[SMS webhook] No Bearer token in Authorization header');
    return;
  }

  const user = await getUserByToken(token).catch(() => null);
  if (!user) {
    console.warn('[SMS webhook] Invalid or unknown token');
    return;
  }

  // PII-safe log — mask phone and account numbers from SMS text
  console.log(`[SMS webhook] User: ${maskPhone(user.whatsapp_number)} | From: ${senderId} | SMS: "${maskAccount(rawSMS).slice(0, 60)}..."`);

  // Log raw SMS
  const { data: smsLog } = await supabase
    .from('sms_logs')
    .insert({ raw_sms: rawSMS, status: 'pending' })
    .select()
    .single()
    .catch(() => ({ data: null }));

  // ── Check for telecom/recharge SMS (Jio, Airtel, Vi, BSNL) ──
  // These come from telecom senders, not banks — handle separately
  if (isRechargeSMS(rawSMS)) {
    const recharge = parseRechargeSMS(rawSMS);
    if (recharge && recharge.nextDueDate) {
      try {
        await addRechargeReminder(user.id, recharge.provider, recharge.amount, recharge.nextDueDate);
        const dueDateLabel = new Date(recharge.nextDueDate).toLocaleDateString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric'
        });
        await sendMessage(user.whatsapp_number,
          `📱 *${recharge.provider} Recharge detected!*\n\n` +
          (recharge.amount ? `💰 Pack: ₹${recharge.amount}\n` : '') +
          `📅 Validity: *${dueDateLabel}*\n` +
          `🔔 Aapko *2 din pehle* reminder milega!\n\n` +
          `_"reminders dikhao" — upcoming reminders dekhne ke liye_`
        );
        if (smsLog) await supabase.from('sms_logs').update({ status: 'logged', parsed_data: recharge }).eq('id', smsLog.id).catch(() => {});
        console.log(`[SMS webhook] Recharge reminder set: ${recharge.provider}, due ${recharge.nextDueDate}`);
      } catch (err) {
        console.error('[SMS webhook] Recharge reminder failed:', err.message);
      }
    }
    // If it's also a bank debit for recharge, fall through to log as expense
    if (!isBankSMS(rawSMS)) return;
  }

  // Check if this looks like a bank SMS
  if (!isBankSMS(rawSMS)) {
    console.log('[SMS webhook] Not a bank SMS, ignoring');
    if (smsLog) await supabase.from('sms_logs').update({ status: 'ignored' }).eq('id', smsLog.id).catch(() => {});
    return;
  }

  // Parse the SMS
  const parsed = parseSMS(rawSMS);

  if (!parsed.isValid) {
    console.log('[SMS webhook] Could not parse SMS');
    if (smsLog) await supabase.from('sms_logs').update({ status: 'failed', parsed_data: { error: 'parse_failed' } }).eq('id', smsLog.id).catch(() => {});
    return;
  }

  const txDate = received_at ? new Date(received_at).toISOString() : parsed.transactionDate;

  // ── CREDIT: check if it's income (salary, freelance, NEFT, etc.) ──
  if (parsed.transactionType === 'credit') {
    if (!isIncomeSMS(rawSMS, parsed.amount)) {
      console.log('[SMS webhook] Small/unrecognised credit — skipping');
      if (smsLog) await supabase.from('sms_logs').update({ status: 'ignored', parsed_data: parsed }).eq('id', smsLog.id).catch(() => {});
      return;
    }

    const incomeCategory = detectIncomeCategory(parsed.description, rawSMS);
    try {
      const { confirmMsg } = await logIncome({
        userId:          user.id,
        amount:          parsed.amount,
        category:        incomeCategory,
        description:     parsed.description,
        source:          'sms',
        rawInput:        null,   // never store raw bank SMS (PII)
        transactionDate: txDate
      });
      if (smsLog) await supabase.from('sms_logs').update({ status: 'logged', parsed_data: parsed }).eq('id', smsLog.id).catch(() => {});
      await sendMessage(user.whatsapp_number, confirmMsg);
      console.log(`[SMS webhook] Income logged ₹${parsed.amount} (${incomeCategory}) for ${maskPhone(user.whatsapp_number)}`);
    } catch (err) {
      console.error('[SMS webhook] Failed to log income:', err.message);
      if (smsLog) await supabase.from('sms_logs').update({ status: 'failed', parsed_data: { error: err.message } }).eq('id', smsLog.id).catch(() => {});
    }
    return;
  }

  // ── DEBIT: check for recharge SMS first (non-bank, telecom) ──
  // Recharge SMS comes from Jio/Airtel/Vi — detected before bank parse
  // Note: isRechargeSMS is checked on raw SMS regardless of parseSMS result

  // ── DEBIT: check for EMI deduction ──
  if (parsed.transactionType === 'debit' && detectEmiFromSMS(rawSMS)) {
    const emiName = inferEmiName(rawSMS);
    // Check if this EMI is already tracked; if not, auto-create it
    const today = new Date();
    const dueDay = today.getDate();
    try {
      const newEmi = await addEmi(user.id, emiName, parsed.amount, dueDay);
      await scheduleEmiReminder(user.id, newEmi);
      console.log(`[SMS webhook] EMI auto-detected: ${emiName} ₹${parsed.amount}`);
      // Also log the deduction as an expense (category: emi/finance)
    } catch (emiErr) {
      console.error('[SMS webhook] EMI schedule failed:', emiErr.message);
      // Continue to log as expense even if EMI tracking fails
    }
  }

  // ── DEBIT: log as expense ──
  const catObj = detectCategory(parsed.description);

  try {
    const { confirmMsg } = await logExpense({
      userId:          user.id,
      amount:          parsed.amount,
      category:        catObj.id,
      description:     parsed.description,
      source:          'sms',
      rawInput:        null,
      transactionDate: txDate,
      toNumber:        user.whatsapp_number
    });

    if (smsLog) await supabase.from('sms_logs').update({ status: 'logged', parsed_data: parsed }).eq('id', smsLog.id).catch(() => {});
    await sendMessage(user.whatsapp_number, confirmMsg);
    console.log(`[SMS webhook] Expense logged ₹${parsed.amount} — ${parsed.description} for ${maskPhone(user.whatsapp_number)}`);
  } catch (err) {
    console.error('[SMS webhook] Failed to log expense:', err.message);
    if (smsLog) await supabase.from('sms_logs').update({ status: 'failed', parsed_data: { error: err.message } }).eq('id', smsLog.id).catch(() => {});
  }
});

module.exports = router;
