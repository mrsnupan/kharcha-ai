/**
 * Savings Goals Model — "Goa trip 20000", "New phone 15000"
 * Tracks progress toward user-defined financial goals.
 */
const supabase = require('./db');

// ──────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────

/**
 * Create a new savings goal.
 */
async function addGoal(userId, name, targetAmount, deadline = null) {
  const { data, error } = await supabase
    .from('savings_goals')
    .insert({
      user_id:        userId,
      name,
      target_amount:  targetAmount,
      current_amount: 0,
      deadline:       deadline || null,
      status:         'active'
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * List all active goals for a user.
 */
async function listGoals(userId) {
  const { data, error } = await supabase
    .from('savings_goals')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active'])
    .order('created_at');

  if (error) throw error;
  return data || [];
}

/**
 * Find a goal by partial name match.
 */
async function findGoalByName(userId, name) {
  const { data, error } = await supabase
    .from('savings_goals')
    .select('*')
    .eq('user_id', userId)
    .ilike('name', `%${name}%`)
    .in('status', ['active'])
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

/**
 * Add an amount toward a savings goal.
 * Auto-marks goal as 'completed' if target is reached.
 * Returns the updated goal record.
 */
async function addToGoal(goalId, amount) {
  const { data: goal, error: fetchErr } = await supabase
    .from('savings_goals')
    .select('current_amount, target_amount, name')
    .eq('id', goalId)
    .single();

  if (fetchErr) throw fetchErr;

  const newAmount = Number(goal.current_amount) + amount;
  const updates   = { current_amount: newAmount };

  if (newAmount >= Number(goal.target_amount)) {
    updates.status = 'completed';
  }

  const { data, error } = await supabase
    .from('savings_goals')
    .update(updates)
    .eq('id', goalId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Mark a goal as completed manually.
 */
async function completeGoal(goalId) {
  const { error } = await supabase
    .from('savings_goals')
    .update({ status: 'completed' })
    .eq('id', goalId);
  if (error) throw error;
}

/**
 * Cancel a goal.
 */
async function cancelGoal(goalId) {
  const { error } = await supabase
    .from('savings_goals')
    .update({ status: 'cancelled' })
    .eq('id', goalId);
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────
// FORMATTING
// ──────────────────────────────────────────────────────────

/**
 * Format a single goal's progress as a WhatsApp message.
 */
function formatGoalProgress(goal) {
  const current = Number(goal.current_amount);
  const target  = Number(goal.target_amount);
  const pct     = Math.min(100, Math.round((current / target) * 100));

  // Visual bar: 10 blocks
  const filled = Math.round(pct / 10);
  const bar = '🟩'.repeat(Math.max(0, filled)) + '⬜'.repeat(Math.max(0, 10 - filled));

  const remaining = Math.max(0, target - current);

  let deadlineStr = '';
  if (goal.deadline) {
    const due  = new Date(goal.deadline);
    const days = Math.ceil((due - new Date()) / (1000 * 60 * 60 * 24));
    const dateLabel = due.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    deadlineStr = `\n📅 Deadline: ${dateLabel} `;
    deadlineStr += days > 0 ? `(${days} din baaki)` : '⚠️ _(overdue)_';
  }

  let statusStr = '';
  if (goal.status === 'completed') {
    statusStr = '\n\n🎉 *Goal achieve ho gayi!* Badhaai ho! 🎊';
  }

  return (
    `🎯 *${goal.name}*\n` +
    `${bar} ${pct}%\n` +
    `💰 ₹${fmtNum(current)} / ₹${fmtNum(target)}\n` +
    `📉 Abhi chahiye: ₹${fmtNum(remaining)}` +
    deadlineStr +
    statusStr
  );
}

/**
 * Format all goals into a summary message.
 */
function formatGoalsList(goals) {
  if (goals.length === 0) {
    return (
      `🎯 *Koi savings goal nahi hai.*\n\n` +
      `_Goal set karne ke liye:_\n` +
      `_"Goa trip ke liye 20000 bachana hai"_\n` +
      `_"New phone 15000, 3 mahine mein"_`
    );
  }

  const lines = goals.map(g => {
    const current = Number(g.current_amount);
    const target  = Number(g.target_amount);
    const pct     = Math.min(100, Math.round((current / target) * 100));
    const filled  = Math.round(pct / 5); // 20 steps for inline
    const bar     = '█'.repeat(filled) + '░'.repeat(20 - filled);
    return (
      `🎯 *${g.name}*\n` +
      `   ${bar} ${pct}%\n` +
      `   ₹${fmtNum(current)} / ₹${fmtNum(target)}`
    );
  });

  const totalTarget  = goals.reduce((s, g) => s + Number(g.target_amount), 0);
  const totalCurrent = goals.reduce((s, g) => s + Number(g.current_amount), 0);

  return (
    `🎯 *Savings Goals*\n\n` +
    lines.join('\n\n') +
    `\n━━━━━━━━━━━━━━\n` +
    `📊 Total saved: ₹${fmtNum(totalCurrent)} / ₹${fmtNum(totalTarget)}\n\n` +
    `_"Goal mein 5000 daalo" — amount add karne ke liye_`
  );
}

function fmtNum(n) {
  return Number(n).toLocaleString('en-IN');
}

module.exports = {
  addGoal,
  listGoals,
  findGoalByName,
  addToGoal,
  completeGoal,
  cancelGoal,
  formatGoalProgress,
  formatGoalsList
};
