/**
 * Tax Engine — Indian Income Tax Calculator
 * FY 2024-25 (AY 2025-26) — Budget 2024 updated slabs
 *
 * Pure computation — zero DB calls. Import and use freely.
 */

// ──────────────────────────────────────────────────────────
// TAX SLABS — FY 2024-25
// ──────────────────────────────────────────────────────────

// Old Regime — unchanged from previous years
const OLD_SLABS = [
  { upTo: 250000,   rate: 0.00 },
  { upTo: 500000,   rate: 0.05 },
  { upTo: 1000000,  rate: 0.20 },
  { upTo: Infinity, rate: 0.30 }
];

// New Regime — Budget 2024 revised slabs (applicable FY 2024-25)
const NEW_SLABS = [
  { upTo: 300000,   rate: 0.00 },
  { upTo: 700000,   rate: 0.05 },
  { upTo: 1000000,  rate: 0.10 },
  { upTo: 1200000,  rate: 0.15 },
  { upTo: 1500000,  rate: 0.20 },
  { upTo: Infinity, rate: 0.30 }
];

const CESS_RATE = 0.04; // 4% Health & Education Cess

// Section 87A Rebate
const REBATE_OLD = { maxIncome: 500000,  maxRebate: 12500 };
const REBATE_NEW = { maxIncome: 700000,  maxRebate: 25000 };

// Standard deduction (Budget 2024 update)
const STD_DEDUCTION_OLD = 50000;  // salaried, old regime
const STD_DEDUCTION_NEW = 75000;  // salaried, new regime (Budget 2024)

// ──────────────────────────────────────────────────────────
// DEDUCTION LIMITS (Old Regime)
// ──────────────────────────────────────────────────────────

const DEDUCTION_LIMITS = {
  '80C':   { limit: 150000, label: 'Section 80C',  desc: 'PPF, ELSS, LIC, EPF, Home Loan Principal, Tuition Fees' },
  '80D':   { limit: 25000,  label: 'Section 80D',  desc: 'Health Insurance Premium' },
  '80D_SENIOR': { limit: 50000, label: '80D (Senior Citizen)', desc: 'Health Insurance for Senior Citizen' },
  '80E':   { limit: null,   label: 'Section 80E',  desc: 'Education Loan Interest (no ceiling)' },
  '24b':   { limit: 200000, label: 'Section 24(b)', desc: 'Home Loan Interest (self-occupied)' },
  '80CCD': { limit: 50000,  label: 'Section 80CCD(1B)', desc: 'Additional NPS Contribution' },
  '80G':   { limit: null,   label: 'Section 80G',  desc: 'Donations (varies by recipient)' },
  '80TTA': { limit: 10000,  label: 'Section 80TTA', desc: 'Savings Account Interest' }
};

// Subcategory labels for display
const SUBCATEGORY_LABELS = {
  ppf:              'PPF Deposit',
  elss:             'ELSS / Mutual Fund',
  lic:              'LIC Premium',
  epf:              'Employee PF',
  home_loan_principal: 'Home Loan Principal',
  tuition_fees:     'Tuition Fees',
  nsc:              'NSC',
  tax_saver_fd:     'Tax Saver FD',
  sukanya:          'Sukanya Samriddhi',
  nps_80c:          'NPS (80C)',
  health_self:      'Health Insurance (Self/Family)',
  health_parents:   'Health Insurance (Parents)',
  preventive:       'Preventive Health Checkup',
  education_loan:   'Education Loan Interest',
  home_loan_interest: 'Home Loan Interest',
  nps_additional:   'NPS Additional (80CCD)',
  donation:         'Donation',
  savings_interest: 'Savings A/c Interest'
};

// ──────────────────────────────────────────────────────────
// FINANCIAL YEAR HELPERS
// ──────────────────────────────────────────────────────────

/**
 * Returns current financial year string e.g. "2024-25"
 * Indian FY: April 1 to March 31
 */
function getCurrentFY() {
  const now   = new Date();
  const month = now.getMonth() + 1; // 1-indexed
  const year  = now.getFullYear();
  return month >= 4
    ? `${year}-${String(year + 1).slice(2)}`
    : `${year - 1}-${String(year).slice(2)}`;
}

/**
 * Returns { start: Date, end: Date } for a financial year string.
 */
function getFYDates(fy) {
  const [startYearStr] = fy.split('-');
  const startYear = parseInt(startYearStr);
  return {
    start: new Date(`${startYear}-04-01T00:00:00.000Z`),
    end:   new Date(`${startYear + 1}-03-31T23:59:59.999Z`)
  };
}

/**
 * Returns months remaining in current FY (1 = March, 12 = April)
 */
function monthsRemainingInFY() {
  const now   = new Date();
  const month = now.getMonth() + 1;
  return month >= 4 ? (15 - month) : (3 - month + 1);
}

// ──────────────────────────────────────────────────────────
// TAX CALCULATION CORE
// ──────────────────────────────────────────────────────────

/**
 * Calculate tax using a slab structure.
 */
function calcSlabTax(income, slabs) {
  let tax = 0;
  let prev = 0;
  for (const slab of slabs) {
    if (income <= prev) break;
    const taxable = Math.min(income, slab.upTo) - prev;
    tax += taxable * slab.rate;
    prev = slab.upTo;
  }
  return Math.round(tax);
}

/**
 * Calculate surcharge based on income.
 * New regime: capped at 25% surcharge.
 */
function calcSurcharge(income, tax, regime) {
  if (income <= 5000000) return 0;
  let rate = 0;
  if (income <= 10000000)  rate = 0.10;
  else if (income <= 20000000) rate = 0.15;
  else if (income <= 50000000) rate = regime === 'new' ? 0.25 : 0.25;
  else rate = regime === 'new' ? 0.25 : 0.37;
  return Math.round(tax * rate);
}

/**
 * Old Regime tax calculation.
 * @param {number} grossIncome - Total annual income (salary + other)
 * @param {object} deductions  - { '80C': amount, '80D': amount, '80E': amount, '24b': amount, '80CCD': amount }
 * @param {boolean} isSalaried
 * @param {boolean} hasSeniorParent - for 80D senior citizen limit
 */
function calcOldRegime(grossIncome, deductions = {}, isSalaried = true, hasSeniorParent = false) {
  let taxableIncome = grossIncome;

  // Standard deduction (salaried only)
  if (isSalaried) taxableIncome -= STD_DEDUCTION_OLD;

  // 80C — cap at ₹1.5L
  const ded80C = Math.min(deductions['80C'] || 0, 150000);
  taxableIncome -= ded80C;

  // 80D — ₹25K self, ₹50K for senior citizen parents
  const selfLimit   = 25000;
  const parentLimit = hasSeniorParent ? 50000 : 25000;
  const ded80D_self    = Math.min(deductions['80D_self']    || 0, selfLimit);
  const ded80D_parents = Math.min(deductions['80D_parents'] || 0, parentLimit);
  taxableIncome -= (ded80D_self + ded80D_parents);

  // 80E — no ceiling
  taxableIncome -= (deductions['80E'] || 0);

  // 24(b) — ₹2L
  taxableIncome -= Math.min(deductions['24b'] || 0, 200000);

  // 80CCD(1B) — ₹50K additional NPS
  taxableIncome -= Math.min(deductions['80CCD'] || 0, 50000);

  // 80TTA — ₹10K
  taxableIncome -= Math.min(deductions['80TTA'] || 0, 10000);

  taxableIncome = Math.max(0, Math.round(taxableIncome));

  const baseTax   = calcSlabTax(taxableIncome, OLD_SLABS);
  const surcharge = calcSurcharge(taxableIncome, baseTax, 'old');
  const rebate    = taxableIncome <= REBATE_OLD.maxIncome ? Math.min(baseTax, REBATE_OLD.maxRebate) : 0;
  const taxAfterRebate = Math.max(0, baseTax - rebate);
  const cess      = Math.round((taxAfterRebate + surcharge) * CESS_RATE);
  const totalTax  = taxAfterRebate + surcharge + cess;

  return {
    regime:        'old',
    grossIncome,
    taxableIncome,
    stdDeduction:  isSalaried ? STD_DEDUCTION_OLD : 0,
    deductions80C: ded80C,
    deductions80D: ded80D_self + ded80D_parents,
    baseTax,
    surcharge,
    rebate,
    cess,
    totalTax:      Math.max(0, totalTax),
    effectiveRate: grossIncome > 0 ? ((totalTax / grossIncome) * 100).toFixed(1) : '0.0',
    monthlyTDS:    Math.round(Math.max(0, totalTax) / 12)
  };
}

/**
 * New Regime tax calculation (Budget 2024).
 * No deductions except standard deduction + NPS employer (not tracked here).
 */
function calcNewRegime(grossIncome, isSalaried = true) {
  let taxableIncome = grossIncome;

  // Standard deduction (Budget 2024 — ₹75,000 for salaried)
  if (isSalaried) taxableIncome -= STD_DEDUCTION_NEW;

  taxableIncome = Math.max(0, Math.round(taxableIncome));

  const baseTax   = calcSlabTax(taxableIncome, NEW_SLABS);
  const surcharge = calcSurcharge(taxableIncome, baseTax, 'new');
  const rebate    = taxableIncome <= REBATE_NEW.maxIncome ? Math.min(baseTax, REBATE_NEW.maxRebate) : 0;
  const taxAfterRebate = Math.max(0, baseTax - rebate);
  const cess      = Math.round((taxAfterRebate + surcharge) * CESS_RATE);
  const totalTax  = taxAfterRebate + surcharge + cess;

  return {
    regime:        'new',
    grossIncome,
    taxableIncome,
    stdDeduction:  isSalaried ? STD_DEDUCTION_NEW : 0,
    baseTax,
    surcharge,
    rebate,
    cess,
    totalTax:      Math.max(0, totalTax),
    effectiveRate: grossIncome > 0 ? ((totalTax / grossIncome) * 100).toFixed(1) : '0.0',
    monthlyTDS:    Math.round(Math.max(0, totalTax) / 12)
  };
}

/**
 * Compare both regimes and recommend the better one.
 */
function compareRegimes(grossIncome, deductions = {}, isSalaried = true, hasSeniorParent = false) {
  const old = calcOldRegime(grossIncome, deductions, isSalaried, hasSeniorParent);
  const nw  = calcNewRegime(grossIncome, isSalaried);
  const savings = nw.totalTax - old.totalTax;

  return {
    oldRegime:       old,
    newRegime:       nw,
    betterRegime:    old.totalTax <= nw.totalTax ? 'old' : 'new',
    savingsAmount:   Math.abs(savings),
    savingsWithOld:  savings > 0,   // true = old regime saves more
    bothZero:        old.totalTax === 0 && nw.totalTax === 0
  };
}

// ──────────────────────────────────────────────────────────
// ADVANCE TAX (Quarterly installments)
// ──────────────────────────────────────────────────────────

const ADVANCE_TAX_SCHEDULE = [
  { quarter: 'Q1', dueDate: 'June 15',     cumPct: 0.15, remindDate: '06-08' },
  { quarter: 'Q2', dueDate: 'September 15', cumPct: 0.45, remindDate: '09-08' },
  { quarter: 'Q3', dueDate: 'December 15',  cumPct: 0.75, remindDate: '12-08' },
  { quarter: 'Q4', dueDate: 'March 15',     cumPct: 1.00, remindDate: '03-08' }
];

/**
 * Calculate advance tax installment due for a quarter.
 * @param {number} estimatedAnnualTax - Based on projected annual income
 * @param {string} quarter - 'Q1' | 'Q2' | 'Q3' | 'Q4'
 * @param {number} paidSoFar - Total advance tax already paid
 */
function calcAdvanceTaxInstallment(estimatedAnnualTax, quarter, paidSoFar = 0) {
  const schedule = ADVANCE_TAX_SCHEDULE.find(s => s.quarter === quarter);
  if (!schedule) return null;
  const cumDue   = Math.round(estimatedAnnualTax * schedule.cumPct);
  const installment = Math.max(0, cumDue - paidSoFar);
  return {
    quarter,
    dueDate:      schedule.dueDate,
    cumulative:   cumDue,
    installment,
    paidSoFar
  };
}

// ──────────────────────────────────────────────────────────
// TAX NUDGES
// ──────────────────────────────────────────────────────────

/**
 * Generate actionable tax-saving suggestions based on:
 * - Estimated annual income
 * - Deductions logged so far this FY
 * - Months remaining in FY
 */
function getTaxNudges(annualIncome, deductionTotals = {}, hasSeniorParent = false) {
  const nudges = [];
  const remaining = monthsRemainingInFY();

  // 80C nudge
  const used80C = deductionTotals['80C'] || 0;
  const left80C = Math.max(0, 150000 - used80C);
  if (annualIncome > 300000 && left80C > 0) {
    const monthly80C = Math.round(left80C / Math.max(1, remaining));
    nudges.push(
      `💡 *80C:* ₹${fmt(left80C)} abhi baaki hai (limit ₹1.5L).\n` +
      `   ELSS, PPF, ya LIC mein invest karo.\n` +
      `   _Har mahine ₹${fmt(monthly80C)} daaloge toh limit full ho jaayegi!_`
    );
  }

  // 80D nudge
  const used80D = (deductionTotals['80D_self'] || 0) + (deductionTotals['80D_parents'] || 0);
  const max80D  = 25000 + (hasSeniorParent ? 50000 : 25000);
  const left80D = Math.max(0, max80D - used80D);
  if (annualIncome > 300000 && left80D > 0 && used80D === 0) {
    nudges.push(
      `💡 *80D:* Health insurance pe ₹${fmt(max80D)} tak tax free hai!\n` +
      `   Abhi koi health insurance log nahi kiya.\n` +
      `   _Family health insurance lena consider karo._`
    );
  }

  // 80CCD(1B) NPS nudge
  const used80CCD = deductionTotals['80CCD'] || 0;
  if (annualIncome > 600000 && used80CCD === 0) {
    nudges.push(
      `💡 *80CCD(1B):* NPS mein ₹50,000 extra invest karo!\n` +
      `   Ye 80C ke ₹1.5L se ALAG hai — total ₹2L savings!\n` +
      `   _NPS se retirement + tax dono fayda._`
    );
  }

  // Home loan nudge
  if (annualIncome > 500000) {
    const used24b   = deductionTotals['24b'] || 0;
    const used80C_hlp = 0; // principal — tracked in 80C
    if (used24b === 0) {
      nudges.push(
        `💡 *24(b):* Home loan interest pe ₹2L tak deduction milta hai!\n` +
        `   _Home loan hai toh interest amount log karo._`
      );
    }
  }

  // Regime switch nudge — compare
  if (annualIncome > 0) {
    const totalDeductions = (deductionTotals['80C'] || 0) +
      (deductionTotals['80D_self'] || 0) + (deductionTotals['80D_parents'] || 0) +
      (deductionTotals['80E'] || 0) + (deductionTotals['24b'] || 0) +
      (deductionTotals['80CCD'] || 0);

    // Old regime benefits when deductions > ~₹2.5L generally
    if (totalDeductions < 150000 && annualIncome > 700000) {
      nudges.push(
        `💡 *Regime:* Abhi tak ₹${fmt(totalDeductions)} deductions hain.\n` +
        `   ₹1.5L se zyada deductions hone par *Old Regime* better ho sakta hai.\n` +
        `   _"old vs new regime compare karo" — exact comparison ke liye_`
      );
    }
  }

  if (nudges.length === 0) {
    nudges.push(`✅ *Bahut achha!* Aapke deductions well-optimized lag rahe hain.\n_"tax kitna banega?" — exact estimate ke liye_`);
  }

  return nudges;
}

// ──────────────────────────────────────────────────────────
// FORMATTING HELPERS
// ──────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n).toLocaleString('en-IN');
}

function fmtTax(result) {
  const regimeLabel = result.regime === 'old' ? 'Old Regime' : 'New Regime (Budget 2024)';
  let msg = `📊 *${regimeLabel}*\n`;
  msg += `💰 Gross Income: ₹${fmt(result.grossIncome)}\n`;
  msg += `📉 Standard Deduction: ₹${fmt(result.stdDeduction)}\n`;
  if (result.regime === 'old') {
    if (result.deductions80C > 0) msg += `📉 80C Deductions: ₹${fmt(result.deductions80C)}\n`;
    if (result.deductions80D > 0) msg += `📉 80D Deductions: ₹${fmt(result.deductions80D)}\n`;
  }
  msg += `📋 Taxable Income: ₹${fmt(result.taxableIncome)}\n`;
  if (result.rebate > 0) msg += `🎁 87A Rebate: -₹${fmt(result.rebate)}\n`;
  if (result.surcharge > 0) msg += `➕ Surcharge: ₹${fmt(result.surcharge)}\n`;
  msg += `🏥 Cess (4%): ₹${fmt(result.cess)}\n`;
  msg += `━━━━━━━━━━━━━━\n`;
  msg += `💸 *Total Tax: ₹${fmt(result.totalTax)}*\n`;
  msg += `📈 Effective Rate: ${result.effectiveRate}%\n`;
  msg += `📅 Monthly TDS: ~₹${fmt(result.monthlyTDS)}`;
  return msg;
}

module.exports = {
  calcOldRegime,
  calcNewRegime,
  compareRegimes,
  calcAdvanceTaxInstallment,
  getTaxNudges,
  getCurrentFY,
  getFYDates,
  monthsRemainingInFY,
  DEDUCTION_LIMITS,
  SUBCATEGORY_LABELS,
  ADVANCE_TAX_SCHEDULE,
  fmt,
  fmtTax
};
