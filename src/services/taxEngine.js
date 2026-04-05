/**
 * Tax Engine — Indian Income Tax Calculator
 * FY 2025-26 (AY 2026-27) — Budget 2025 updated slabs
 *
 * Key Budget 2025 changes (effective April 1, 2025):
 *  - New Regime: completely revised slabs (4L/8L/12L/16L/20L/24L bands)
 *  - New Regime: 87A rebate ₹60,000 for income up to ₹12L (was ₹25K up to ₹7L)
 *  - Salaried zero-tax threshold: ₹12.75L (₹12L + ₹75K std deduction)
 *  - Old Regime: no change
 *
 * Pure computation — zero DB calls. Import and use freely.
 */

// ──────────────────────────────────────────────────────────
// TAX SLABS — FY 2025-26 (Budget 2025)
// ──────────────────────────────────────────────────────────

// Old Regime — unchanged
const OLD_SLABS = [
  { upTo: 250000,   rate: 0.00 },
  { upTo: 500000,   rate: 0.05 },
  { upTo: 1000000,  rate: 0.20 },
  { upTo: Infinity, rate: 0.30 }
];

// New Regime — Budget 2025 revised slabs (FY 2025-26)
// Major change: zero-tax slab raised to ₹4L, new 25% band added, 87A rebate ₹60K
const NEW_SLABS = [
  { upTo: 400000,   rate: 0.00 },
  { upTo: 800000,   rate: 0.05 },
  { upTo: 1200000,  rate: 0.10 },
  { upTo: 1600000,  rate: 0.15 },
  { upTo: 2000000,  rate: 0.20 },
  { upTo: 2400000,  rate: 0.25 },
  { upTo: Infinity, rate: 0.30 }
];

const CESS_RATE = 0.04; // 4% Health & Education Cess

// Section 87A Rebate
// Old regime: unchanged — ₹12,500 for income up to ₹5L
// New regime: Budget 2025 raised to ₹60,000 for income up to ₹12L
const REBATE_OLD = { maxIncome: 500000,   maxRebate: 12500  };
const REBATE_NEW = { maxIncome: 1200000,  maxRebate: 60000  };

// Standard deduction
const STD_DEDUCTION_OLD = 50000;  // salaried, old regime — unchanged
const STD_DEDUCTION_NEW = 75000;  // salaried, new regime — unchanged from Budget 2024

// ──────────────────────────────────────────────────────────
// DEDUCTION LIMITS (Old Regime)
// ──────────────────────────────────────────────────────────

const DEDUCTION_LIMITS = {
  '80C':         { limit: 150000, label: 'Section 80C',             desc: 'PPF, ELSS, LIC, EPF, Home Loan Principal, Tuition Fees' },
  '80D':         { limit: 25000,  label: 'Section 80D',             desc: 'Health Insurance Premium (self/family)' },
  '80D_self':    { limit: 25000,  label: '80D Self/Family',         desc: 'Health Insurance for self & family (≤60 yrs)' },
  '80D_parents': { limit: 25000,  label: '80D Parents',             desc: 'Health Insurance for parents (₹50K if senior citizen)' },
  '80D_SENIOR':  { limit: 50000,  label: '80D Senior Citizen',      desc: 'Health Insurance for Senior Citizen parent (60+ yrs)' },
  '80E':         { limit: null,   label: 'Section 80E',             desc: 'Education Loan Interest (no ceiling)' },
  '24b':         { limit: 200000, label: 'Section 24(b)',           desc: 'Home Loan Interest (self-occupied)' },
  '80CCD':       { limit: 50000,  label: 'Section 80CCD(1B)',       desc: 'Additional NPS Contribution (over 80C limit)' },
  '80G':         { limit: null,   label: 'Section 80G',             desc: 'Donations (varies by recipient)' },
  '80TTA':       { limit: 10000,  label: 'Section 80TTA',           desc: 'Savings Account Interest (non-senior)' },
  '80TTB':       { limit: 50000,  label: 'Section 80TTB',           desc: 'Interest income for Senior Citizens (60+)' }
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
 * New Regime tax calculation (Budget 2025 — FY 2025-26).
 * No deductions except standard deduction for salaried.
 * Key change: zero-tax up to ₹12L (rebate ₹60K), new 25% slab at ₹20L-₹24L.
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

  // ── Marginal Relief (Budget 2025) ──────────────────────────
  // When taxable income slightly exceeds ₹12L (the 87A rebate threshold),
  // tax cannot exceed (taxable_income − ₹12L). This prevents the cliff edge
  // where earning ₹1 extra causes a massive tax jump.
  // Applies for taxable income between ₹12L and ~₹12,70,588.
  let taxBeforeCess = taxAfterRebate + surcharge;
  if (taxableIncome > REBATE_NEW.maxIncome) {
    const marginalCap = taxableIncome - REBATE_NEW.maxIncome; // income above ₹12L
    if (taxBeforeCess > marginalCap) {
      taxBeforeCess = marginalCap; // cap tax to marginal relief amount
    }
  }

  const cess     = Math.round(taxBeforeCess * CESS_RATE);
  const totalTax = taxBeforeCess + cess;

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
    effectiveRate: grossIncome > 0 ? ((Math.max(0, totalTax) / grossIncome) * 100).toFixed(1) : '0.0',
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
/**
 * @param {number} annualIncome
 * @param {object} deductionTotals
 * @param {boolean} hasSeniorParent
 * @param {string} userRegime - 'old' | 'new' (default 'new')
 */
function getTaxNudges(annualIncome, deductionTotals = {}, hasSeniorParent = false, userRegime = 'new') {
  const nudges    = [];
  const remaining = monthsRemainingInFY();
  const isOld     = userRegime === 'old';

  // ── New Regime users: show Budget 2025 zero-tax benefit ──
  if (!isOld) {
    if (annualIncome > 0 && annualIncome <= 1275000) {
      nudges.push(
        `🎉 *Budget 2025 — Zero Tax!*\n` +
        `   Income ₹12.75L tak *zero tax* under New Regime.\n` +
        `   (₹12L rebate + ₹75K standard deduction for salaried)\n` +
        `   _"tax kitna banega?" — confirm karo_`
      );
    } else if (annualIncome > 1275000) {
      nudges.push(
        `💡 *New Regime (Budget 2025)* is default and better for most.\n` +
        `   No deductions needed — clean & simple slabs.\n` +
        `   _"old vs new regime compare karo" — sirf check ke liye_`
      );
    }
    // New regime: 80C/80D/24b deductions don't apply — skip those tips
    // Only show NPS employer tip (80CCD(2) is allowed in new regime)
    if (annualIncome > 600000) {
      nudges.push(
        `💡 *NPS 80CCD(2):* Employer NPS contribution (up to 10% of salary)\n` +
        `   is allowed as deduction *even in New Regime!*\n` +
        `   _Ask your HR to route CTC via NPS for extra tax saving._`
      );
    }
  }

  // ── Old Regime users: show deduction tips ──
  if (isOld) {
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
    if (annualIncome > 300000 && used80D === 0) {
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
    if (annualIncome > 500000 && !(deductionTotals['24b'] || 0)) {
      nudges.push(
        `💡 *24(b):* Home loan interest pe ₹2L tak deduction milta hai!\n` +
        `   _Home loan hai toh interest amount log karo._`
      );
    }

    // Regime switch nudge for old regime users
    const totalDeductions = (deductionTotals['80C'] || 0) +
      (deductionTotals['80D_self'] || 0) + (deductionTotals['80D_parents'] || 0) +
      (deductionTotals['80E'] || 0) + (deductionTotals['24b'] || 0) +
      (deductionTotals['80CCD'] || 0);
    if (totalDeductions < 375000 && annualIncome > 1275000) {
      nudges.push(
        `⚠️ *Regime Check:* Deductions ₹${fmt(totalDeductions)} hain.\n` +
        `   New Regime better ho sakta hai (Budget 2025).\n` +
        `   _"old vs new regime compare karo" — exact comparison ke liye_`
      );
    }
  }

  if (nudges.length === 0) {
    nudges.push(`✅ *Bahut achha!* Tax planning well-optimized lag rahi hai.\n_"tax kitna banega?" — exact estimate ke liye_`);
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
  const regimeLabel = result.regime === 'old' ? 'Old Regime' : 'New Regime (Budget 2025)';
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
