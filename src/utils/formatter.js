const { getCategoryById } = require('./categories');

/**
 * Format a rupee amount nicely: 1234 → ₹1,234
 */
function formatAmount(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

/**
 * Format an expense object into a confirmation message
 */
function formatExpenseConfirmation(expense, source = 'chat') {
  const cat = getCategoryById(expense.category);
  const prefix = source === 'sms' ? '✅' : source === 'voice' ? '🎤' : '✅';
  return `${prefix} ${formatAmount(expense.amount)} logged — ${expense.description} (${cat.label} ${cat.emoji})`;
}

/**
 * Format voice confirmation with transcription
 */
function formatVoiceConfirmation(transcript, expense) {
  const cat = getCategoryById(expense.category);
  return (
    `🎤 Suna: '${transcript}'\n` +
    `✅ ${formatAmount(expense.amount)} logged — ${expense.description} ${cat.emoji}`
  );
}

/**
 * Format a daily/weekly/monthly summary
 */
function formatSummary(expenses, period, totalBudget = null) {
  if (!expenses || expenses.length === 0) {
    return `📊 ${period} mein koi expense nahi mila.`;
  }

  // Group by category
  const byCategory = {};
  let total = 0;
  for (const exp of expenses) {
    const cat = getCategoryById(exp.category);
    if (!byCategory[exp.category]) {
      byCategory[exp.category] = { cat, total: 0, count: 0 };
    }
    byCategory[exp.category].total += Number(exp.amount);
    byCategory[exp.category].count += 1;
    total += Number(exp.amount);
  }

  let lines = [`📊 *${period} ka Summary*\n`];
  const sorted = Object.values(byCategory).sort((a, b) => b.total - a.total);
  for (const { cat, total: t, count } of sorted) {
    lines.push(`${cat.emoji} ${cat.label}: ${formatAmount(t)} (${count} transactions)`);
  }
  lines.push(`\n💰 *Total: ${formatAmount(total)}*`);

  if (totalBudget) {
    const remaining = totalBudget - total;
    const pct = Math.round((total / totalBudget) * 100);
    lines.push(`🎯 Budget: ${formatAmount(totalBudget)} | Used: ${pct}% | Remaining: ${formatAmount(Math.max(0, remaining))}`);
  }

  return lines.join('\n');
}

/**
 * Format budget alert messages
 */
function formatBudgetAlert(categoryLabel, emoji, spent, limit, percentage) {
  if (percentage >= 100) {
    return (
      `🚨 *${emoji} ${categoryLabel} budget exceeded!*\n` +
      `${formatAmount(spent)} spent vs ${formatAmount(limit)} budget\n` +
      `Over by ${formatAmount(spent - limit)}`
    );
  } else {
    const remaining = limit - spent;
    return (
      `⚠️ *${emoji} ${categoryLabel} budget 80% used!*\n` +
      `${formatAmount(spent)} of ${formatAmount(limit)} spent.\n` +
      `${formatAmount(remaining)} remaining`
    );
  }
}

/**
 * Format comparison report (e.g., this month vs last month)
 */
function formatComparison(currentTotal, prevTotal, currentLabel, prevLabel) {
  const diff = currentTotal - prevTotal;
  const diffAmt = formatAmount(Math.abs(diff));
  const arrow = diff > 0 ? '📈 +' : '📉 -';
  const msg = diff > 0 ? 'zyada kharch hua' : 'kam kharch hua';
  return (
    `📊 *Comparison*\n` +
    `${prevLabel}: ${formatAmount(prevTotal)}\n` +
    `${currentLabel}: ${formatAmount(currentTotal)}\n` +
    `${arrow}${diffAmt} ${msg}`
  );
}

/**
 * Format a category-wise query result
 */
function formatCategoryReport(categoryLabel, emoji, expenses, period) {
  if (!expenses || expenses.length === 0) {
    return `${emoji} ${period} mein ${categoryLabel} pe koi expense nahi mila.`;
  }
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  let lines = [`${emoji} *${categoryLabel} — ${period}*\n`];
  for (const exp of expenses.slice(0, 10)) {
    const d = new Date(exp.transaction_date || exp.created_at);
    const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
    lines.push(`• ${dateStr} — ${exp.description}: ${formatAmount(exp.amount)}`);
  }
  if (expenses.length > 10) lines.push(`... aur ${expenses.length - 10} transactions`);
  lines.push(`\n💰 *Total: ${formatAmount(total)}*`);
  return lines.join('\n');
}

module.exports = {
  formatAmount,
  formatExpenseConfirmation,
  formatVoiceConfirmation,
  formatSummary,
  formatBudgetAlert,
  formatComparison,
  formatCategoryReport
};
