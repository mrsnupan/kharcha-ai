/**
 * Tax Deduction Model
 * CRUD for 80C, 80D, 80E, 24b, 80CCD deductions per financial year.
 * Also manages user tax profile (regime, income type, senior parent flag).
 */
const supabase       = require('./db');
const { getCurrentFY, getFYDates } = require('../services/taxEngine');

// ──────────────────────────────────────────────────────────
// DEDUCTION CRUD
// ──────────────────────────────────────────────────────────

/**
 * Log a tax deduction entry.
 */
async function logDeduction({ userId, section, subCategory, amount, description, financialYear }) {
  const fy = financialYear || getCurrentFY();

  const { data, error } = await supabase
    .from('tax_deductions')
    .insert({
      user_id:        userId,
      section,
      sub_category:   subCategory || null,
      amount,
      description:    description || null,
      financial_year: fy
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get all deductions for a user in a financial year.
 */
async function getDeductionsByFY(userId, financialYear) {
  const fy = financialYear || getCurrentFY();

  const { data, error } = await supabase
    .from('tax_deductions')
    .select('*')
    .eq('user_id', userId)
    .eq('financial_year', fy)
    .order('created_at');

  if (error) throw error;
  return data || [];
}

/**
 * Get a summarized totals object grouped by section.
 * Returns:
 * {
 *   '80C':         { logged: 125000, limit: 150000, remaining: 25000, entries: [...] },
 *   '80D_self':    { logged: 12000,  limit: 25000,  remaining: 13000 },
 *   '80D_parents': { logged: 0,      limit: 25000,  remaining: 25000 },
 *   '80E':         { logged: 0,      limit: null },
 *   '24b':         { logged: 0,      limit: 200000 },
 *   '80CCD':       { logged: 0,      limit: 50000  }
 * }
 */
async function getDeductionSummary(userId, financialYear, hasSeniorParent = false) {
  const deductions = await getDeductionsByFY(userId, financialYear);

  const totals = {
    '80C':         { logged: 0, limit: 150000, entries: [] },
    '80D_self':    { logged: 0, limit: 25000,  entries: [] },
    '80D_parents': { logged: 0, limit: hasSeniorParent ? 50000 : 25000, entries: [] },
    '80E':         { logged: 0, limit: null,   entries: [] },
    '24b':         { logged: 0, limit: 200000, entries: [] },
    '80CCD':       { logged: 0, limit: 50000,  entries: [] },
    '80G':         { logged: 0, limit: null,   entries: [] },
    '80TTA':       { logged: 0, limit: 10000,  entries: [] }
  };

  for (const d of deductions) {
    const key = d.section; // '80C', '80D_self', '80D_parents', '80E', etc.
    if (totals[key] !== undefined) {
      totals[key].logged += Number(d.amount);
      totals[key].entries.push(d);
    }
  }

  // Compute remaining (capped at 0)
  for (const key of Object.keys(totals)) {
    const t = totals[key];
    t.logged = Math.round(t.logged);
    if (t.limit !== null) {
      t.effective = Math.min(t.logged, t.limit); // actual deductible amount
      t.remaining = Math.max(0, t.limit - t.logged);
    } else {
      t.effective = t.logged;
      t.remaining = null; // no ceiling
    }
  }

  return totals;
}

/**
 * Helper: flat deductions map for taxEngine.calcOldRegime()
 */
function flattenDeductions(summary) {
  return {
    '80C':         summary['80C']?.effective        || 0,
    '80D_self':    summary['80D_self']?.effective   || 0,
    '80D_parents': summary['80D_parents']?.effective || 0,
    '80E':         summary['80E']?.effective        || 0,
    '24b':         summary['24b']?.effective        || 0,
    '80CCD':       summary['80CCD']?.effective      || 0,
    '80TTA':       summary['80TTA']?.effective      || 0
  };
}

/**
 * Delete a deduction entry by id.
 */
async function deleteDeduction(userId, deductionId) {
  const { error } = await supabase
    .from('tax_deductions')
    .delete()
    .eq('id', deductionId)
    .eq('user_id', userId); // safety check
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────
// USER TAX PROFILE
// ──────────────────────────────────────────────────────────

/**
 * Get user's tax profile fields.
 */
async function getTaxProfile(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('tax_regime, income_type, has_senior_parent')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data || { tax_regime: 'new', income_type: 'salaried', has_senior_parent: false };
}

/**
 * Update user's tax profile.
 */
async function updateTaxProfile(userId, { taxRegime, incomeType, hasSeniorParent }) {
  const updates = {};
  if (taxRegime        !== undefined) updates.tax_regime        = taxRegime;
  if (incomeType       !== undefined) updates.income_type       = incomeType;
  if (hasSeniorParent  !== undefined) updates.has_senior_parent = hasSeniorParent;

  const { error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId);
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────
// ANNUAL INCOME FROM incomes TABLE (for FY)
// ──────────────────────────────────────────────────────────

/**
 * Get total income for a user in a financial year from the incomes table.
 */
async function getAnnualIncome(userId, financialYear) {
  const fy    = financialYear || getCurrentFY();
  const dates = getFYDates(fy);

  const { data, error } = await supabase
    .from('incomes')
    .select('amount, category')
    .eq('user_id', userId)
    .gte('transaction_date', dates.start.toISOString())
    .lte('transaction_date', dates.end.toISOString());

  if (error) throw error;
  const rows = data || [];

  const byCategory = {};
  let total = 0;
  for (const r of rows) {
    const amt = Number(r.amount);
    total += amt;
    byCategory[r.category] = (byCategory[r.category] || 0) + amt;
  }

  return { total: Math.round(total), byCategory };
}

// ──────────────────────────────────────────────────────────
// FORMATTING
// ──────────────────────────────────────────────────────────

/**
 * Format deduction summary as a WhatsApp message.
 */
function formatDeductionSummary(summary, fy) {
  const sections = [
    { key: '80C',         label: '80C (PPF/ELSS/LIC/EPF)',       emoji: '🏦' },
    { key: '80D_self',    label: '80D Self/Family Health Ins.',  emoji: '💊' },
    { key: '80D_parents', label: '80D Parents Health Ins.',      emoji: '👴' },
    { key: '80E',         label: '80E Education Loan Interest',  emoji: '📚' },
    { key: '24b',         label: '24(b) Home Loan Interest',     emoji: '🏠' },
    { key: '80CCD',       label: '80CCD(1B) Extra NPS',          emoji: '📈' },
    { key: '80TTA',       label: '80TTA Savings Interest',       emoji: '💰' }
  ];

  let msg = `🧾 *Tax Deductions Summary — FY ${fy}*\n\n`;

  let totalSaving = 0;
  for (const s of sections) {
    const t = summary[s.key];
    if (!t) continue;
    if (t.logged === 0 && t.limit !== null && t.limit <= 25000) continue; // skip zero small sections

    const logged = `₹${fmtN(t.logged)}`;
    const limit  = t.limit ? `₹${fmtN(t.limit)}` : 'No limit';
    const bar    = t.limit ? makeBar(t.logged, t.limit) : '∞';
    const remaining = t.remaining !== null
      ? (t.remaining > 0 ? `  ⚡ ₹${fmtN(t.remaining)} baaki` : '  ✅ Full!') : '';

    msg += `${s.emoji} *${s.label}*\n`;
    msg += `   ${bar}  ${logged} / ${limit}${remaining}\n`;
    totalSaving += t.effective || 0;
  }

  msg += `\n━━━━━━━━━━━━━━\n`;
  msg += `📉 *Total Deductions: ₹${fmtN(totalSaving)}*\n\n`;
  msg += `_"tax kitna banega?" — estimate ke liye_\n`;
  msg += `_"tax saving tips" — suggestions ke liye_`;
  return msg;
}

function makeBar(used, limit) {
  const pct    = Math.min(1, used / limit);
  const filled = Math.round(pct * 8);
  const color  = pct >= 0.9 ? '🟢' : pct >= 0.5 ? '🟡' : '🔴';
  return color + '█'.repeat(filled) + '░'.repeat(8 - filled);
}

function fmtN(n) {
  return Number(n).toLocaleString('en-IN');
}

module.exports = {
  logDeduction,
  getDeductionsByFY,
  getDeductionSummary,
  flattenDeductions,
  deleteDeduction,
  getTaxProfile,
  updateTaxProfile,
  getAnnualIncome,
  formatDeductionSummary
};
