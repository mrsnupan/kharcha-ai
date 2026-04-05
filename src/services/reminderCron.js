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

module.exports = {
  startReminderCron,
  processReminders,
  addRechargeReminder,
  addCustomReminder,
  listReminders
};
