/**
 * GST Expense Model — Phase 3
 * Tracks GST paid on business purchases for Input Tax Credit (ITC) reconciliation.
 * Each GST expense ALSO creates a regular expense entry for seamless reporting.
 */
const supabase = require('./db');

const GST_RATES = [0, 5, 12, 18, 28]; // standard Indian GST slabs

// ──────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────

/**
 * Log a GST expense.
 * @param {number} baseAmount   - Amount BEFORE GST
 * @param {number} gstRate      - 5 | 12 | 18 | 28
 * @param {string} vendorGstin  - Optional GSTIN of vendor
 * @param {string} invoiceNo    - Optional invoice number
 */
async function logGSTExpense({
  userId, baseAmount, gstRate, vendorGstin, invoiceNo,
  category, description, transactionDate
}) {
  const rate       = GST_RATES.includes(gstRate) ? gstRate : 18; // default 18%
  const gstAmount  = Math.round(baseAmount * rate / 100 * 100) / 100;
  const totalAmount = baseAmount + gstAmount;

  const { data, error } = await supabase
    .from('gst_expenses')
    .insert({
      user_id:          userId,
      base_amount:      baseAmount,
      gst_rate:         rate,
      gst_amount:       gstAmount,
      total_amount:     totalAmount,
      vendor_gstin:     vendorGstin  || null,
      invoice_number:   invoiceNo    || null,
      category:         category     || 'other',
      description:      description  || null,
      transaction_date: transactionDate || new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;
  return { ...data, gstAmount, totalAmount };
}

/**
 * Get all GST expenses within a date range.
 */
async function getGSTExpenses(userId, fromDate, toDate) {
  const { data, error } = await supabase
    .from('gst_expenses')
    .select('*')
    .eq('user_id', userId)
    .gte('transaction_date', fromDate)
    .lte('transaction_date', toDate)
    .order('transaction_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Get GST summary for a period.
 * Returns totals by GST rate and total ITC claimable.
 */
async function getGSTSummary(userId, fromDate, toDate) {
  const expenses = await getGSTExpenses(userId, fromDate, toDate);

  const byRate = {};
  let totalBase = 0;
  let totalGST  = 0;

  for (const e of expenses) {
    const rate = Number(e.gst_rate);
    if (!byRate[rate]) byRate[rate] = { base: 0, gst: 0, count: 0 };
    byRate[rate].base  += Number(e.base_amount);
    byRate[rate].gst   += Number(e.gst_amount);
    byRate[rate].count += 1;
    totalBase += Number(e.base_amount);
    totalGST  += Number(e.gst_amount);
  }

  return {
    totalBase:    Math.round(totalBase),
    totalGST:     Math.round(totalGST),
    totalAmount:  Math.round(totalBase + totalGST),
    byRate,
    entryCount:   expenses.length
  };
}

// ──────────────────────────────────────────────────────────
// FORMATTING
// ──────────────────────────────────────────────────────────

/**
 * Format GST summary as WhatsApp message.
 */
function formatGSTSummary(summary, fromLabel, toLabel) {
  if (summary.entryCount === 0) {
    return (
      `📊 *GST Summary — ${fromLabel} to ${toLabel}*\n\n` +
      `Koi GST expense record nahi mila.\n\n` +
      `_GST ke saath kharcha log karne ke liye:_\n` +
      `_"Office furniture 5000 + 18% GST"_`
    );
  }

  const rateLines = Object.entries(summary.byRate)
    .sort((a, b) => a[0] - b[0])
    .map(([rate, d]) =>
      `  ${rate}% GST: ₹${fmtN(d.gst)} (on ₹${fmtN(d.base)} — ${d.count} entries)`
    );

  return (
    `🧾 *GST Input Summary*\n_${fromLabel} to ${toLabel}_\n\n` +
    rateLines.join('\n') +
    `\n━━━━━━━━━━━━━━\n` +
    `📦 Total Purchase Value: ₹${fmtN(summary.totalBase)}\n` +
    `💸 Total GST Paid: *₹${fmtN(summary.totalGST)}*\n` +
    `🧾 Total (incl. GST): ₹${fmtN(summary.totalAmount)}\n\n` +
    `_Ye ITC (Input Tax Credit) claim karne ke liye use kar sakte ho_\n` +
    `_CA ko ye summary share karo GSTR filing ke liye_`
  );
}

function fmtN(n) {
  return Number(n).toLocaleString('en-IN');
}

module.exports = {
  logGSTExpense,
  getGSTExpenses,
  getGSTSummary,
  formatGSTSummary,
  GST_RATES
};
