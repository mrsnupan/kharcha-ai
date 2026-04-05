const supabase = require('./db');

/**
 * Create a new expense record
 */
async function createExpense({ userId, amount, category, description, source, rawInput, transactionDate }) {
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      user_id: userId,
      amount: Number(amount),
      category: category || 'other',
      description: description || '',
      source: source || 'chat',
      raw_input: rawInput || '',
      transaction_date: transactionDate || new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Get expenses for a user (or their whole family) within a date range
 */
async function getExpenses({ userId, familyId, startDate, endDate, category, limit = 100 }) {
  let query = supabase
    .from('expenses')
    .select('*')
    .order('transaction_date', { ascending: false })
    .limit(limit);

  if (familyId) {
    // Get all user_ids in family first
    const { data: members, error: memErr } = await supabase
      .from('users')
      .select('id')
      .eq('family_id', familyId);
    if (memErr) throw memErr;
    const ids = members.map(m => m.id);
    query = query.in('user_id', ids);
  } else {
    query = query.eq('user_id', userId);
  }

  if (startDate) query = query.gte('transaction_date', startDate);
  if (endDate)   query = query.lte('transaction_date', endDate);
  if (category)  query = query.eq('category', category);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Get today's expenses
 */
async function getTodayExpenses(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return getExpenses({
    userId,
    startDate: today.toISOString(),
    endDate: tomorrow.toISOString()
  });
}

/**
 * Get this week's expenses (Mon–Sun)
 */
async function getWeekExpenses(userId) {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  monday.setHours(0, 0, 0, 0);

  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);

  return getExpenses({
    userId,
    startDate: monday.toISOString(),
    endDate: nextMonday.toISOString()
  });
}

/**
 * Get this month's expenses
 */
async function getMonthExpenses(userId, month = null, year = null) {
  const now = new Date();
  const m = month !== null ? month : now.getMonth(); // 0-indexed
  const y = year !== null ? year : now.getFullYear();
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 1);

  return getExpenses({
    userId,
    startDate: start.toISOString(),
    endDate: end.toISOString()
  });
}

/**
 * Get last month's expenses
 */
async function getLastMonthExpenses(userId) {
  const now = new Date();
  const m = now.getMonth() - 1;
  const y = m < 0 ? now.getFullYear() - 1 : now.getFullYear();
  return getMonthExpenses(userId, (m + 12) % 12, y);
}

/**
 * Get category-specific expenses for current month
 */
async function getCategoryMonthExpenses(userId, category) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return getExpenses({
    userId,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    category
  });
}

/**
 * Get the most recent expense for a user
 */
async function getLastExpense(userId) {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Delete a specific expense by ID (must belong to user)
 */
async function deleteExpense(userId, expenseId) {
  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', expenseId)
    .eq('user_id', userId); // safety: only delete own expenses
  if (error) throw error;
}

/**
 * Delete the most recent expense for a user.
 * Returns the deleted expense or null if none found.
 */
async function deleteLastExpense(userId) {
  const last = await getLastExpense(userId);
  if (!last) return null;
  await deleteExpense(userId, last.id);
  return last;
}

/**
 * Delete the most recent expense matching a given amount.
 * Returns the deleted expense or null if not found.
 */
async function deleteExpenseByAmount(userId, amount) {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('user_id', userId)
    .eq('amount', Number(amount))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  await deleteExpense(userId, data.id);
  return data;
}

module.exports = {
  createExpense,
  getExpenses,
  getTodayExpenses,
  getWeekExpenses,
  getMonthExpenses,
  getLastMonthExpenses,
  getCategoryMonthExpenses,
  getLastExpense,
  deleteExpense,
  deleteLastExpense,
  deleteExpenseByAmount
};
