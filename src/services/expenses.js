const { createExpense, getTodayExpenses, getWeekExpenses, getMonthExpenses,
        getLastMonthExpenses, getCategoryMonthExpenses } = require('../models/expense');
const { setBudget, getBudget, getAllBudgets } = require('../models/budget');
const { getCategoryById, detectCategory } = require('../utils/categories');
const {
  formatExpenseConfirmation,
  formatSummary,
  formatBudgetAlert,
  formatComparison,
  formatCategoryReport,
  formatAmount
} = require('../utils/formatter');
const { sendMessage } = require('./whatsapp');

/**
 * Log an expense and return confirmation message string.
 * Also checks budget thresholds and sends alerts if needed.
 */
async function logExpense({ userId, amount, category, description, source, rawInput, transactionDate, toNumber }) {
  const expense = await createExpense({ userId, amount, category, description, source, rawInput, transactionDate });

  const confirmMsg = formatExpenseConfirmation(expense, source);

  // Check budget and potentially send an alert
  const alertMsg = await checkBudgetAlert(userId, category, toNumber);

  return { expense, confirmMsg, alertMsg };
}

/**
 * Check if a category (or total) budget is hit after adding a new expense.
 * Sends a WhatsApp alert if 80% or 100% threshold is crossed.
 * Returns the alert message string or null.
 */
async function checkBudgetAlert(userId, category, toNumber) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  // Check category budget
  const catBudget = await getBudget({ userId, category, month, year });
  if (catBudget) {
    const expenses = await getCategoryMonthExpenses(userId, category);
    const spent = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const pct = (spent / catBudget.monthly_limit) * 100;
    const cat = getCategoryById(category);

    if (pct >= 100 || (pct >= 90 && spent < Number(catBudget.monthly_limit))) {
      const msg = formatBudgetAlert(cat.label, cat.emoji, spent, catBudget.monthly_limit, pct);
      if (toNumber) {
        await sendMessage(toNumber, msg).catch(e => console.error('[Alert]', e.message));
      }
      return msg;
    }
  }

  // Check total budget
  const totalBudget = await getBudget({ userId, category: 'total', month, year });
  if (totalBudget) {
    const allExpenses = await getMonthExpenses(userId);
    const spent = allExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const pct = (spent / totalBudget.monthly_limit) * 100;

    if (pct >= 100 || (pct >= 90 && spent < totalBudget.monthly_limit)) {
      const msg = formatBudgetAlert('Total', '💰', spent, totalBudget.monthly_limit, pct);
      if (toNumber) {
        await sendMessage(toNumber, msg).catch(e => console.error('[Alert]', e.message));
      }
      return msg;
    }
  }

  return null;
}

/**
 * Handle a query message — returns a reply string
 */
async function handleQuery(parsed, userId) {
  const { query_type, query_category } = parsed;

  if (query_type === 'daily') {
    const expenses = await getTodayExpenses(userId);
    return formatSummary(expenses, 'Aaj');
  }

  if (query_type === 'weekly') {
    const expenses = await getWeekExpenses(userId);
    return formatSummary(expenses, 'Is hafte');
  }

  if (query_type === 'monthly') {
    const now = new Date();
    const expenses = await getMonthExpenses(userId);
    const budget = await getBudget({ userId, category: 'total', month: now.getMonth() + 1, year: now.getFullYear() });
    return formatSummary(expenses, 'Is mahine', budget ? budget.monthly_limit : null);
  }

  if (query_type === 'category' && query_category) {
    const expenses = await getCategoryMonthExpenses(userId, query_category);
    const cat = getCategoryById(query_category);
    return formatCategoryReport(cat.label, cat.emoji, expenses, 'Is mahine');
  }

  if (query_type === 'comparison') {
    const now = new Date();
    const thisMonth = await getMonthExpenses(userId);
    const lastMonth = await getLastMonthExpenses(userId);
    const thisTotal = thisMonth.reduce((s, e) => s + Number(e.amount), 0);
    const lastTotal = lastMonth.reduce((s, e) => s + Number(e.amount), 0);

    const lastMonthName = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      .toLocaleString('en-IN', { month: 'long' });
    const thisMonthName = now.toLocaleString('en-IN', { month: 'long' });

    return formatComparison(thisTotal, lastTotal, thisMonthName, lastMonthName);
  }

  if (query_type === 'budget') {
    const budgets = await getAllBudgets(userId);
    if (!budgets.length) {
      return "Koi budget set nahi hai. 'grocery budget 8000' likhke budget set karo 🎯";
    }
    const now = new Date();
    const monthExpenses = await getMonthExpenses(userId);
    let lines = ['🎯 *Budget Status — Is Mahine*\n'];
    for (const b of budgets) {
      const cat = getCategoryById(b.category);
      const catExpenses = b.category === 'total'
        ? monthExpenses
        : monthExpenses.filter(e => e.category === b.category);
      const spent = catExpenses.reduce((s, e) => s + Number(e.amount), 0);
      const pct = Math.round((spent / b.monthly_limit) * 100);
      const bar = buildProgressBar(pct);
      lines.push(`${cat.emoji} ${cat.label}: ${formatAmount(spent)}/${formatAmount(b.monthly_limit)} (${pct}%)\n${bar}`);
    }
    return lines.join('\n');
  }

  return "Samajh nahi aaya. 'aaj kitna gaya?' ya 'monthly report' try karo 😊";
}

/**
 * Handle setting a budget — returns reply string
 */
async function handleSetBudget({ userId, category, amount }) {
  const budget = await setBudget({
    userId,
    category: category || 'total',
    monthlyLimit: amount
  });
  const cat = getCategoryById(budget.category);
  return `✅ ${cat.emoji} ${cat.label} budget set: ${formatAmount(amount)}/month`;
}

// Simple text progress bar
function buildProgressBar(pct) {
  const filled = Math.min(Math.round(pct / 10), 10);
  const empty = 10 - filled;
  const color = pct >= 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢';
  return color + '▓'.repeat(filled) + '░'.repeat(empty) + ` ${pct}%`;
}

module.exports = { logExpense, handleQuery, handleSetBudget, checkBudgetAlert };
