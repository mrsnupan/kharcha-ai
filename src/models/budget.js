const supabase = require('./db');

/**
 * Upsert a budget for a user+category+month/year
 */
async function setBudget({ userId, category, monthlyLimit, month, year }) {
  const now = new Date();
  const m = month !== undefined ? month : now.getMonth() + 1; // 1-indexed
  const y = year  !== undefined ? year  : now.getFullYear();

  const { data, error } = await supabase
    .from('budgets')
    .upsert({
      user_id: userId,
      category: category || 'total',
      monthly_limit: Number(monthlyLimit),
      month: m,
      year: y
    }, { onConflict: 'user_id,category,month,year' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Get a specific budget
 */
async function getBudget({ userId, category, month, year }) {
  const now = new Date();
  const m = month !== undefined ? month : now.getMonth() + 1;
  const y = year  !== undefined ? year  : now.getFullYear();

  const { data, error } = await supabase
    .from('budgets')
    .select('*')
    .eq('user_id', userId)
    .eq('category', category || 'total')
    .eq('month', m)
    .eq('year', y)
    .single();

  if (error && error.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

/**
 * Get all budgets for a user for the current month
 */
async function getAllBudgets(userId, month = null, year = null) {
  const now = new Date();
  const m = month !== null ? month : now.getMonth() + 1;
  const y = year  !== null ? year  : now.getFullYear();

  const { data, error } = await supabase
    .from('budgets')
    .select('*')
    .eq('user_id', userId)
    .eq('month', m)
    .eq('year', y);
  if (error) throw error;
  return data || [];
}

module.exports = { setBudget, getBudget, getAllBudgets };
