const supabase = require('./db');

// Income categories
const INCOME_CATEGORIES = {
  salary:     { id: 'salary',     label: 'Salary',      emoji: '💼' },
  freelance:  { id: 'freelance',  label: 'Freelance',   emoji: '💻' },
  business:   { id: 'business',   label: 'Business',    emoji: '🏪' },
  rent:       { id: 'rent',       label: 'Rent',        emoji: '🏠' },
  investment: { id: 'investment', label: 'Investment',  emoji: '📈' },
  transfer:   { id: 'transfer',   label: 'Transfer',    emoji: '🔄' },
  refund:     { id: 'refund',     label: 'Refund',      emoji: '↩️' },
  other:      { id: 'other',      label: 'Other',       emoji: '💰' }
};

/**
 * Log an income entry.
 */
async function logIncome({ userId, amount, category = 'other', description = '',
  source = 'chat', rawInput = null, transactionDate = null }) {

  const cat = INCOME_CATEGORIES[category] || INCOME_CATEGORIES.other;

  const { data, error } = await supabase
    .from('incomes')
    .insert({
      user_id:          userId,
      amount,
      category:         cat.id,
      description,
      source,
      raw_input:        rawInput,
      transaction_date: transactionDate || new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;

  const confirmMsg =
    `${cat.emoji} *Income logged!*\n\n` +
    `💰 Amount: *₹${Number(amount).toLocaleString('en-IN')}*\n` +
    `📂 Category: ${cat.label}\n` +
    `📝 ${description || 'Income received'}\n` +
    `📅 ${new Date(data.transaction_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;

  return { income: data, confirmMsg };
}

/**
 * Get total income for a given month/year.
 */
async function getMonthlyIncome(userId, month, year) {
  const start = new Date(year, month - 1, 1).toISOString();
  const end   = new Date(year, month, 0, 23, 59, 59).toISOString();

  const { data, error } = await supabase
    .from('incomes')
    .select('amount, category, description, transaction_date')
    .eq('user_id', userId)
    .gte('transaction_date', start)
    .lte('transaction_date', end)
    .order('transaction_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Get income vs expense summary for a month — used for savings calculation.
 */
async function getIncomeVsExpense(userId, month, year) {
  const incomes = await getMonthlyIncome(userId, month, year);

  const totalIncome = incomes.reduce((s, i) => s + Number(i.amount), 0);

  // Get expenses from expenses table
  const start = new Date(year, month - 1, 1).toISOString();
  const end   = new Date(year, month, 0, 23, 59, 59).toISOString();
  const { data: expenses } = await supabase
    .from('expenses')
    .select('amount')
    .eq('user_id', userId)
    .gte('transaction_date', start)
    .lte('transaction_date', end);

  const totalExpense = (expenses || []).reduce((s, e) => s + Number(e.amount), 0);
  const savings = totalIncome - totalExpense;

  return { totalIncome, totalExpense, savings, incomes };
}

/**
 * Detect income category from SMS description or keywords.
 */
function detectIncomeCategory(description = '', smsText = '') {
  const combined = `${description} ${smsText}`.toLowerCase();
  if (/salary|sal |payroll|ctc|stipend/i.test(combined))     return 'salary';
  if (/freelance|freelancing|project\s*pay|invoice/i.test(combined)) return 'freelance';
  if (/rent\s*recv|rent\s*received|house\s*rent/i.test(combined)) return 'rent';
  if (/dividend|interest|mutual\s*fund|mf\s*redeem/i.test(combined)) return 'investment';
  if (/refund|cashback|reversal/i.test(combined))             return 'refund';
  if (/business|profit|commission/i.test(combined))           return 'business';
  if (/neft|rtgs|imps|transfer|trf/i.test(combined))         return 'transfer';
  return 'other';
}

/**
 * Format income vs expense summary message.
 */
function formatIncomeVsExpense({ totalIncome, totalExpense, savings, month, year }) {
  const monthName = new Date(year, month - 1).toLocaleString('en-IN', { month: 'long' });
  const savingsPct = totalIncome > 0 ? Math.round((savings / totalIncome) * 100) : 0;
  const savingsEmoji = savings >= 0 ? '✅' : '⚠️';

  const bar = (amt, total) => {
    if (!total) return '░░░░░';
    const filled = Math.round((amt / total) * 5);
    return '█'.repeat(Math.min(filled, 5)) + '░'.repeat(Math.max(5 - filled, 0));
  };

  return (
    `📊 *${monthName} ${year} — Summary*\n\n` +
    `💰 Income:  *₹${totalIncome.toLocaleString('en-IN')}*\n` +
    `💸 Expense: *₹${totalExpense.toLocaleString('en-IN')}*  ${bar(totalExpense, totalIncome)}\n` +
    `─────────────────────\n` +
    `${savingsEmoji} Savings: *₹${Math.abs(savings).toLocaleString('en-IN')}*` +
    (totalIncome > 0 ? ` (${savingsPct}%)` : '') +
    (savings < 0 ? '\n⚠️ _Kharcha income se zyada hai!_' : '')
  );
}

module.exports = {
  logIncome,
  getMonthlyIncome,
  getIncomeVsExpense,
  detectIncomeCategory,
  formatIncomeVsExpense,
  INCOME_CATEGORIES
};
