/**
 * EMI Model — Home loan, car loan, personal loan installments
 * Handles: add, list, update, reminder scheduling, SMS detection
 */
const supabase = require('./db');

// ──────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────

/**
 * Add a new EMI entry for a user.
 */
async function addEmi(userId, name, amount, dueDay, startDate = null, endDate = null) {
  const { data, error } = await supabase
    .from('emis')
    .insert({
      user_id:    userId,
      name,
      amount,
      due_day:    dueDay,
      start_date: startDate || null,
      end_date:   endDate   || null,
      status:     'active'
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * List all EMIs for a user.
 * statusFilter: 'active' | 'paused' | 'completed' | null (all)
 */
async function listEmis(userId, statusFilter = 'active') {
  let query = supabase
    .from('emis')
    .select('*')
    .eq('user_id', userId)
    .order('due_day');

  if (statusFilter) query = query.eq('status', statusFilter);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Find an EMI by name (fuzzy).
 */
async function findEmiByName(userId, name) {
  const { data, error } = await supabase
    .from('emis')
    .select('*')
    .eq('user_id', userId)
    .ilike('name', `%${name}%`)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Update EMI status.
 */
async function updateEmiStatus(emiId, status) {
  const { error } = await supabase
    .from('emis')
    .update({ status })
    .eq('id', emiId);
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────
// REMINDER SCHEDULING
// ──────────────────────────────────────────────────────────

/**
 * Calculate the next due date for an EMI based on due_day (1–31).
 * If due_day has passed this month, returns next month's date.
 */
function getNextDueDate(dueDay) {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), dueDay);
  if (thisMonth > now) return thisMonth;
  return new Date(now.getFullYear(), now.getMonth() + 1, dueDay);
}

/**
 * Schedule a reminder for an EMI's next due date.
 * Skips if reminder already exists for this emi_id + due_date.
 */
async function scheduleEmiReminder(userId, emi) {
  const dueDate    = getNextDueDate(emi.due_day);
  const dueDateStr = dueDate.toISOString().split('T')[0]; // YYYY-MM-DD

  // Skip if already scheduled
  const { data: existing } = await supabase
    .from('reminders')
    .select('id')
    .eq('emi_id', emi.id)
    .eq('due_date', dueDateStr)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await supabase
    .from('reminders')
    .insert({
      user_id:            userId,
      type:               'emi',
      name:               emi.name,
      amount:             emi.amount,
      due_date:           dueDateStr,
      remind_days_before: 2,
      notified:           false,
      recurring:          'monthly',
      emi_id:             emi.id
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Schedule reminders for ALL active EMIs of a user.
 */
async function scheduleAllEmiReminders(userId) {
  const emis = await listEmis(userId, 'active');
  const results = [];
  for (const emi of emis) {
    try {
      const r = await scheduleEmiReminder(userId, emi);
      results.push(r);
    } catch (e) {
      console.error(`[EMI] reminder schedule failed for ${emi.name}:`, e.message);
    }
  }
  return results;
}

// ──────────────────────────────────────────────────────────
// SMS DETECTION
// ──────────────────────────────────────────────────────────

const EMI_KEYWORDS = [
  'emi', 'equated monthly', 'loan instalment', 'loan installment',
  'home loan emi', 'car loan emi', 'personal loan emi',
  'emi deducted', 'emi paid', 'emi debited', 'auto debit', 'nach debit',
  'standing instruction', 'si executed', 'loan repayment'
];

/**
 * Returns true if the SMS text looks like an EMI deduction.
 */
function detectEmiFromSMS(smsText) {
  if (!smsText) return false;
  const lower = smsText.toLowerCase();
  return EMI_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Infer a human-readable EMI name from SMS text.
 */
function inferEmiName(smsText) {
  const lower = smsText.toLowerCase();
  if (lower.includes('home loan'))                      return 'Home Loan EMI';
  if (lower.includes('car loan') || lower.includes('vehicle loan')) return 'Car Loan EMI';
  if (lower.includes('personal loan'))                  return 'Personal Loan EMI';
  if (lower.includes('education loan') || lower.includes('student loan')) return 'Education Loan EMI';
  if (lower.includes('credit card'))                    return 'Credit Card EMI';
  if (lower.includes('nach') || lower.includes('si executed')) return 'Auto-Debit EMI';
  return 'Loan EMI';
}

// ──────────────────────────────────────────────────────────
// FORMATTING
// ──────────────────────────────────────────────────────────

function formatEmiList(emis) {
  if (emis.length === 0) {
    return (
      `📋 *Koi EMI nahi hai.*\n\n` +
      `_EMI add karne ke liye:_\n` +
      `_"Home Loan EMI 12000, date 5"_`
    );
  }

  const total = emis.reduce((s, e) => s + Number(e.amount), 0);
  const lines = emis.map((e, i) => {
    const due = `${e.due_day}${getDaySuffix(e.due_day)} har mahine`;
    return `${i + 1}. *${e.name}* — ₹${Number(e.amount).toLocaleString('en-IN')}\n   📅 ${due}`;
  });

  return (
    `🏦 *Aapki EMIs*\n\n` +
    lines.join('\n') +
    `\n━━━━━━━━━━━━━━\n` +
    `💸 Total EMI per month: *₹${total.toLocaleString('en-IN')}*\n\n` +
    `_"Home Loan EMI band karo" — status update ke liye_`
  );
}

function getDaySuffix(d) {
  if (d >= 11 && d <= 13) return 'th';
  switch (d % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

module.exports = {
  addEmi,
  listEmis,
  findEmiByName,
  updateEmiStatus,
  getNextDueDate,
  scheduleEmiReminder,
  scheduleAllEmiReminders,
  detectEmiFromSMS,
  inferEmiName,
  formatEmiList
};
