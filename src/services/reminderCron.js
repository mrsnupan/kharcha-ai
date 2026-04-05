/**
 * Reminder Cron Service
 * Runs daily at 8 AM IST. Sends WhatsApp alerts for:
 *   - EMI due in 2 days
 *   - Mobile recharge expiring in 2 days
 *   - Custom bill due in 2 days
 * After sending, reschedules monthly recurring reminders.
 */

const cron       = require('node-cron');
const supabase   = require('../models/db');
const { sendMessage } = require('./whatsapp');

// ──────────────────────────────────────────────────────────
// START CRON
// ──────────────────────────────────────────────────────────

/**
 * Start the daily reminder cron.
 * Runs at 02:30 UTC = 08:00 IST.
 */
function startReminderCron() {
  cron.schedule('30 2 * * *', async () => {
    console.log('[Reminders] Daily cron triggered');
    await processReminders();
  }, { timezone: 'UTC' });

  console.log('[Reminders] Daily cron started — fires 8 AM IST');
}

// ──────────────────────────────────────────────────────────
// PROCESS ALL DUE REMINDERS
// ──────────────────────────────────────────────────────────

async function processReminders() {
  try {
    // Today's date in IST (YYYY-MM-DD)
    const utcNow    = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow    = new Date(utcNow.getTime() + istOffset);
    const todayStr  = istNow.toISOString().split('T')[0];

    console.log(`[Reminders] Processing for IST date: ${todayStr}`);

    // Fetch all unnotified reminders with user info
    const { data: reminders, error } = await supabase
      .from('reminders')
      .select(`
        id, user_id, type, name, amount, due_date,
        remind_days_before, notified, recurring, emi_id,
        users ( id, whatsapp_number, name )
      `)
      .eq('notified', false);

    if (error) {
      console.error('[Reminders] DB error:', error.message);
      return;
    }

    if (!reminders || reminders.length === 0) {
      console.log('[Reminders] No pending reminders');
      return;
    }

    let sent = 0;
    for (const reminder of reminders) {
      // Calculate remind_date = due_date − remind_days_before
      const dueDate   = new Date(reminder.due_date);
      const remindDt  = new Date(dueDate);
      remindDt.setDate(remindDt.getDate() - reminder.remind_days_before);
      const remindStr = remindDt.toISOString().split('T')[0];

      if (remindStr !== todayStr) continue; // Not today

      const user = reminder.users;
      if (!user || !user.whatsapp_number) continue;

      try {
        await sendReminderMessage(user, reminder);
        await markNotified(reminder.id);

        // Reschedule next occurrence for monthly recurring
        if (reminder.recurring === 'monthly') {
          await scheduleNextRecurring(user.id, reminder, dueDate);
        }

        sent++;
      } catch (sendErr) {
        console.error(`[Reminders] Failed to send to ${user.id}:`, sendErr.message);
      }
    }

    console.log(`[Reminders] Sent ${sent} reminder(s)`);
  } catch (err) {
    console.error('[Reminders] processReminders error:', err.message);
  }
}

// ──────────────────────────────────────────────────────────
// SEND REMINDER MESSAGE
// ──────────────────────────────────────────────────────────

async function sendReminderMessage(user, reminder) {
  const dueDate    = new Date(reminder.due_date);
  const dueDateStr = dueDate.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric'
  });

  // Days left from today
  const utcNow    = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const todayIST  = new Date(utcNow.getTime() + istOffset);
  todayIST.setHours(0, 0, 0, 0);
  const daysLeft  = Math.ceil((dueDate - todayIST) / (1000 * 60 * 60 * 24));

  const amtStr = reminder.amount
    ? `₹${Number(reminder.amount).toLocaleString('en-IN')}`
    : '';

  let msg;

  if (reminder.type === 'emi') {
    msg =
      `⏰ *EMI Reminder!*\n\n` +
      `🏦 *${reminder.name}*\n` +
      `💰 Amount: *${amtStr}*\n` +
      `📅 Due date: *${dueDateStr}*\n` +
      `⚡ Sirf *${daysLeft} din* baaki!\n\n` +
      `_Samay pe chukta karein — late fee se bachein_ 🙏\n\n` +
      `_"EMI list" likhein sabki list ke liye_`;
  } else if (reminder.type === 'recharge') {
    msg =
      `📱 *Recharge Reminder!*\n\n` +
      `📲 *${reminder.name}*\n` +
      (amtStr ? `💰 Pack: *${amtStr}*\n` : '') +
      `📅 Validity expires: *${dueDateStr}*\n` +
      `⚡ Sirf *${daysLeft} din* baaki!\n\n` +
      `_Recharge karna mat bhoolen!_ 📱`;
  } else if (reminder.type === 'bill') {
    msg =
      `💡 *Bill Reminder!*\n\n` +
      `📋 *${reminder.name}*\n` +
      (amtStr ? `💰 Amount: *${amtStr}*\n` : '') +
      `📅 Due date: *${dueDateStr}*\n` +
      `⚡ Sirf *${daysLeft} din* baaki!\n\n` +
      `_Time pe bill bharein — late fee se bachein!_ 💳`;
  } else {
    msg =
      `🔔 *Reminder!*\n\n` +
      `📋 *${reminder.name}*\n` +
      (amtStr ? `💰 Amount: *${amtStr}*\n` : '') +
      `📅 Due date: *${dueDateStr}*\n` +
      `⚡ Sirf *${daysLeft} din* baaki!`;
  }

  await sendMessage(user.whatsapp_number, msg);
  console.log(`[Reminders] Sent '${reminder.type}' reminder to user ${user.id} for "${reminder.name}"`);
}

// ──────────────────────────────────────────────────────────
// DB HELPERS
// ──────────────────────────────────────────────────────────

async function markNotified(reminderId) {
  const { error } = await supabase
    .from('reminders')
    .update({ notified: true })
    .eq('id', reminderId);
  if (error) console.error('[Reminders] markNotified error:', error.message);
}

/**
 * Schedule the next monthly recurrence of a reminder.
 */
async function scheduleNextRecurring(userId, reminder, currentDueDate) {
  const nextDue = new Date(currentDueDate);
  nextDue.setMonth(nextDue.getMonth() + 1);
  const nextDueStr = nextDue.toISOString().split('T')[0];

  const { error } = await supabase
    .from('reminders')
    .insert({
      user_id:            userId,
      type:               reminder.type,
      name:               reminder.name,
      amount:             reminder.amount || null,
      due_date:           nextDueStr,
      remind_days_before: reminder.remind_days_before,
      notified:           false,
      recurring:          'monthly',
      emi_id:             reminder.emi_id || null
    });

  if (error) console.error('[Reminders] scheduleNextRecurring error:', error.message);
}

/**
 * Manually add a recharge or bill reminder.
 * Called from SMS webhook when recharge SMS is detected.
 */
async function addRechargeReminder(userId, provider, amount, nextDueDate) {
  const { data, error } = await supabase
    .from('reminders')
    .insert({
      user_id:            userId,
      type:               'recharge',
      name:               `${provider} Recharge`,
      amount:             amount || null,
      due_date:           nextDueDate,        // YYYY-MM-DD
      remind_days_before: 2,
      notified:           false,
      recurring:          null               // SMS will set next one when detected
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Add a custom reminder (EMI, bill, etc.) from user chat command.
 */
async function addCustomReminder(userId, type, name, amount, dueDateStr, remindDaysBefore = 2) {
  const { data, error } = await supabase
    .from('reminders')
    .insert({
      user_id:            userId,
      type:               type || 'custom',
      name,
      amount:             amount || null,
      due_date:           dueDateStr,
      remind_days_before: remindDaysBefore,
      notified:           false,
      recurring:          null
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * List all upcoming (unnotified) reminders for a user.
 */
async function listReminders(userId) {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('user_id', userId)
    .eq('notified', false)
    .order('due_date');

  if (error) throw error;
  return data || [];
}

// ──────────────────────────────────────────────────────────
// ADVANCE TAX CRON — Phase 3
// Reminds freelancers/business users 7 days before each due date
// Q1: June 15 → remind June 8
// Q2: Sep  15 → remind Sep  8
// Q3: Dec  15 → remind Dec  8
// Q4: Mar  15 → remind Mar  8
// ──────────────────────────────────────────────────────────

function startAdvanceTaxCron() {
  // All at 02:30 UTC = 08:00 IST
  cron.schedule('30 2 8 6 *',  () => processAdvanceTaxReminders('Q1'), { timezone: 'UTC' });
  cron.schedule('30 2 8 9 *',  () => processAdvanceTaxReminders('Q2'), { timezone: 'UTC' });
  cron.schedule('30 2 8 12 *', () => processAdvanceTaxReminders('Q3'), { timezone: 'UTC' });
  cron.schedule('30 2 8 3 *',  () => processAdvanceTaxReminders('Q4'), { timezone: 'UTC' });
  console.log('[AdvanceTax] Cron started — Q1/Q2/Q3/Q4 reminders on 8th of Jun/Sep/Dec/Mar');
}

const QUARTER_LABELS = {
  Q1: { dueDate: 'June 15',      cumPct: 0.15 },
  Q2: { dueDate: 'September 15', cumPct: 0.45 },
  Q3: { dueDate: 'December 15',  cumPct: 0.75 },
  Q4: { dueDate: 'March 15',     cumPct: 1.00 }
};

async function processAdvanceTaxReminders(quarter) {
  try {
    console.log(`[AdvanceTax] Processing ${quarter} reminders`);

    // Only for freelance/business users with consent
    const { data: users, error } = await supabase
      .from('users')
      .select('id, whatsapp_number, name, income_type, tax_regime')
      .in('income_type', ['freelance', 'business'])
      .not('consent_given_at', 'is', null);

    if (error || !users?.length) {
      console.log(`[AdvanceTax] No eligible users for ${quarter}`);
      return;
    }

    const { getFYDates, getCurrentFY, calcNewRegime, calcOldRegime } = require('../services/taxEngine');
    const fy    = getCurrentFY();
    const dates = getFYDates(fy);

    for (const user of users) {
      try {
        // Estimate annual income from last 12 months
        const { data: incomeRows } = await supabase
          .from('incomes')
          .select('amount')
          .eq('user_id', user.id)
          .gte('transaction_date', dates.start.toISOString())
          .lte('transaction_date', dates.end.toISOString());

        const annualIncome = (incomeRows || []).reduce((s, r) => s + Number(r.amount), 0);
        if (annualIncome <= 0) continue;

        // Estimate tax using user's preferred regime (non-salaried = no std deduction)
        const taxResult = user.tax_regime === 'old'
          ? calcOldRegime(annualIncome, {}, false, false)
          : calcNewRegime(annualIncome, false);
        if (taxResult.totalTax < 10000) continue; // Advance tax not applicable < ₹10K

        const info        = QUARTER_LABELS[quarter];
        const installment = Math.round(taxResult.totalTax * info.cumPct);

        await sendMessage(user.whatsapp_number,
          `📅 *Advance Tax Reminder — ${quarter}*\n\n` +
          `⏰ Due Date: *${info.dueDate}*\n\n` +
          `💰 Estimated Annual Tax: ₹${fmtN(taxResult.totalTax)}\n` +
          `💸 Cumulative due by ${info.dueDate}: *₹${fmtN(installment)}* (${Math.round(info.cumPct * 100)}%)\n\n` +
          `_Ye estimate aapki logged income ke aadhar par hai._\n` +
          `_"advance tax kitna bharna hai?" — full breakdown ke liye_\n` +
          `_"tax summary PDF download karo" — CA ke liye report_\n\n` +
          `⚠️ _Advance tax nahi bharoge toh Section 234B/234C interest lag sakta hai!_`
        );

        console.log(`[AdvanceTax] Sent ${quarter} reminder to user ${user.id}`);
        await new Promise(r => setTimeout(r, 500)); // small delay between sends

      } catch (userErr) {
        console.error(`[AdvanceTax] Failed for user ${user.id}:`, userErr.message);
      }
    }
  } catch (err) {
    console.error(`[AdvanceTax] ${quarter} cron error:`, err.message);
  }
}

function fmtN(n) {
  return Number(n).toLocaleString('en-IN');
}

module.exports = {
  startReminderCron,
  startAdvanceTaxCron,
  processReminders,
  addRechargeReminder,
  addCustomReminder,
  listReminders
};
