/**
 * Tax Export Service — PDF Tax Summary Report
 * Generates a professional FY tax summary PDF using pdfkit.
 * Includes: Income summary, Deductions, Old vs New Regime comparison.
 */

const PDFDocument = require('pdfkit');
const path        = require('path');
const os          = require('os');
const fs          = require('fs');
const { deleteTempFile } = require('./export');

// ──────────────────────────────────────────────────────────
// COLORS & STYLES
// ──────────────────────────────────────────────────────────
const C = {
  primary:   '#1B5E20',  // dark green
  accent:    '#2E7D32',
  light:     '#E8F5E9',
  header:    '#FFFFFF',
  text:      '#212121',
  muted:     '#757575',
  border:    '#BDBDBD',
  warn:      '#E65100',
  blue:      '#1565C0'
};

// ──────────────────────────────────────────────────────────
// MAIN EXPORT FUNCTION
// ──────────────────────────────────────────────────────────

/**
 * Generate Tax Summary PDF.
 * @param {object}  user            - User record { name, whatsapp_number }
 * @param {string}  financialYear   - e.g. "2024-25"
 * @param {object}  incomeData      - { total, byCategory }
 * @param {object}  deductionSummary - from getDeductionSummary()
 * @param {object}  regimeComparison - from compareRegimes()
 * @param {object}  taxProfile      - { tax_regime, income_type }
 * Returns temp file path.
 */
async function generateTaxSummaryPDF(user, financialYear, incomeData, deductionSummary, regimeComparison, taxProfile) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `tax_summary_${user.id || Date.now()}_${financialYear}.pdf`);
    const doc     = new PDFDocument({ margin: 40, size: 'A4' });
    const stream  = fs.createWriteStream(tmpFile);

    doc.pipe(stream);

    const pageW = doc.page.width;
    const margin = 40;
    const contentW = pageW - margin * 2;

    // ── PAGE HEADER ──
    doc.rect(0, 0, pageW, 70).fill(C.primary);
    doc.fillColor(C.header).font('Helvetica-Bold').fontSize(20)
      .text('KharchaAI — Tax Summary Report', margin, 18);
    doc.font('Helvetica').fontSize(11)
      .text(`Financial Year: ${financialYear}  |  AY: ${getAY(financialYear)}`, margin, 44);

    let y = 85;

    // ── USER INFO ──
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(12)
      .text(`Taxpayer: ${user.name || 'User'}`, margin, y);
    doc.font('Helvetica').fontSize(10).fillColor(C.muted)
      .text(`Income Type: ${capitalize(taxProfile.income_type || 'salaried')}  |  Preferred Regime: ${capitalize(taxProfile.tax_regime || 'new')}  |  Generated: ${new Date().toLocaleDateString('en-IN')}`, margin, y + 16);
    y += 40;

    // ── SECTION: INCOME ──
    y = sectionHeader(doc, 'INCOME SUMMARY', y, pageW, margin, C);
    y += 8;

    const incomeRows = Object.entries(incomeData.byCategory || {})
      .filter(([, v]) => v > 0)
      .map(([cat, amt]) => [capitalize(cat), `₹${fmtN(amt)}`]);
    if (incomeRows.length === 0) incomeRows.push(['No income logged this FY', '—']);

    y = drawTable(doc, ['Income Category', 'Amount'], incomeRows, y, margin, contentW, C);

    // Total row
    doc.rect(margin, y, contentW, 22).fill(C.light);
    doc.fillColor(C.primary).font('Helvetica-Bold').fontSize(10)
      .text('TOTAL ANNUAL INCOME', margin + 6, y + 6)
      .text(`₹${fmtN(incomeData.total)}`, margin + contentW - 100, y + 6, { width: 90, align: 'right' });
    y += 28;

    // ── SECTION: DEDUCTIONS ──
    y = sectionHeader(doc, 'TAX DEDUCTIONS (OLD REGIME)', y + 10, pageW, margin, C);
    y += 8;

    const dedSections = [
      { key: '80C',         label: '80C — PPF/ELSS/LIC/EPF/Home Loan Principal', limit: 150000 },
      { key: '80D_self',    label: '80D — Health Insurance (Self/Family)',         limit: 25000  },
      { key: '80D_parents', label: '80D — Health Insurance (Parents)',             limit: null   },
      { key: '80E',         label: '80E — Education Loan Interest',                limit: null   },
      { key: '24b',         label: '24(b) — Home Loan Interest',                   limit: 200000 },
      { key: '80CCD',       label: '80CCD(1B) — Additional NPS',                   limit: 50000  },
      { key: '80TTA',       label: '80TTA — Savings Account Interest',             limit: 10000  }
    ];

    const dedRows = dedSections.map(s => {
      const t     = deductionSummary[s.key] || { logged: 0, effective: 0 };
      const eff   = t.effective || 0;
      const limit = s.limit ? `₹${fmtN(s.limit)}` : 'No limit';
      const status = eff > 0
        ? (s.limit && eff >= s.limit ? '✓ MAX' : `✓ ₹${fmtN(eff)}`)
        : '—';
      return [s.label, limit, status];
    });

    y = drawTable(doc, ['Section', 'Max Limit', 'Claimed'], dedRows, y, margin, contentW, C,
      [contentW * 0.55, contentW * 0.22, contentW * 0.23]);

    const totalDed = Object.values(deductionSummary).reduce((s, t) => s + (t?.effective || 0), 0);
    doc.rect(margin, y, contentW, 22).fill(C.light);
    doc.fillColor(C.primary).font('Helvetica-Bold').fontSize(10)
      .text('TOTAL DEDUCTIONS CLAIMED', margin + 6, y + 6)
      .text(`₹${fmtN(totalDed)}`, margin + contentW - 100, y + 6, { width: 90, align: 'right' });
    y += 32;

    // ── SECTION: REGIME COMPARISON ──
    y = sectionHeader(doc, 'OLD REGIME vs NEW REGIME COMPARISON', y + 10, pageW, margin, C);
    y += 8;

    const old = regimeComparison.oldRegime;
    const nw  = regimeComparison.newRegime;

    const compRows = [
      ['Gross Income',          `₹${fmtN(old.grossIncome)}`,      `₹${fmtN(nw.grossIncome)}`],
      ['Standard Deduction',    `₹${fmtN(old.stdDeduction)}`,     `₹${fmtN(nw.stdDeduction)}`],
      ['Other Deductions',      `₹${fmtN(totalDed)}`,             '—'],
      ['Taxable Income',        `₹${fmtN(old.taxableIncome)}`,    `₹${fmtN(nw.taxableIncome)}`],
      ['Income Tax',            `₹${fmtN(old.baseTax)}`,          `₹${fmtN(nw.baseTax)}`],
      ['Section 87A Rebate',    `₹${fmtN(old.rebate)}`,           `₹${fmtN(nw.rebate)}`],
      ['Health & Edu. Cess',    `₹${fmtN(old.cess)}`,             `₹${fmtN(nw.cess)}`],
      ['Effective Tax Rate',    `${old.effectiveRate}%`,           `${nw.effectiveRate}%`],
      ['Monthly TDS (approx.)', `₹${fmtN(old.monthlyTDS)}`,       `₹${fmtN(nw.monthlyTDS)}`]
    ];

    y = drawTable(doc, ['Particulars', 'Old Regime', 'New Regime'], compRows, y, margin, contentW, C,
      [contentW * 0.45, contentW * 0.27, contentW * 0.28]);

    // Total tax row — highlight winner
    const oldBetter = old.totalTax <= nw.totalTax;
    const oldBg     = oldBetter ? C.light : C.header;
    const newBg     = !oldBetter ? C.light : C.header;

    doc.rect(margin, y, contentW * 0.45, 24).fill(C.accent);
    doc.rect(margin + contentW * 0.45, y, contentW * 0.27, 24).fill(oldBg);
    doc.rect(margin + contentW * 0.72, y, contentW * 0.28, 24).fill(newBg);

    doc.fillColor(C.header).font('Helvetica-Bold').fontSize(10)
      .text('TOTAL TAX PAYABLE', margin + 6, y + 7);

    doc.fillColor(oldBetter ? C.primary : C.text).font('Helvetica-Bold')
      .text(`₹${fmtN(old.totalTax)}` + (oldBetter ? ' ⭐' : ''), margin + contentW * 0.45 + 6, y + 7,
        { width: contentW * 0.27 - 12 });
    doc.fillColor(!oldBetter ? C.primary : C.text)
      .text(`₹${fmtN(nw.totalTax)}` + (!oldBetter ? ' ⭐' : ''), margin + contentW * 0.72 + 6, y + 7,
        { width: contentW * 0.28 - 12 });

    y += 30;

    // ── RECOMMENDATION BOX ──
    y += 8;
    const savAmt = regimeComparison.savingsAmount;
    const recRegime = regimeComparison.betterRegime === 'old' ? 'Old Regime' : 'New Regime';
    const recMsg = regimeComparison.bothZero
      ? 'No tax payable in either regime. You are within exemption limits.'
      : `*${recRegime}* is better for you — saves ₹${fmtN(savAmt)} in taxes this year!`;

    doc.rect(margin, y, contentW, 40).fill(C.light).stroke(C.primary);
    doc.fillColor(C.primary).font('Helvetica-Bold').fontSize(11)
      .text('💡 RECOMMENDATION:', margin + 10, y + 8);
    doc.font('Helvetica').fontSize(10).fillColor(C.text)
      .text(recMsg, margin + 10, y + 22, { width: contentW - 20 });
    y += 48;

    // ── ADVANCE TAX (freelance/business only) ──
    if (taxProfile.income_type !== 'salaried' && old.totalTax > 10000) {
      y += 8;
      y = sectionHeader(doc, 'ADVANCE TAX SCHEDULE (Non-Salaried)', y, pageW, margin, C);
      y += 8;

      const advTax    = Math.max(old.totalTax, nw.totalTax);
      const advRows   = [
        ['Q1 — June 15',      '15%', `₹${fmtN(Math.round(advTax * 0.15))}`],
        ['Q2 — September 15', '45%', `₹${fmtN(Math.round(advTax * 0.45))}`],
        ['Q3 — December 15',  '75%', `₹${fmtN(Math.round(advTax * 0.75))}`],
        ['Q4 — March 15',     '100%', `₹${fmtN(advTax)}`]
      ];
      y = drawTable(doc, ['Due Date', 'Cumulative %', 'Amount Due'], advRows, y, margin, contentW, C,
        [contentW * 0.45, contentW * 0.2, contentW * 0.35]);
      y += 8;
    }

    // ── FOOTER ──
    doc.moveDown(1);
    doc.rect(0, doc.page.height - 50, pageW, 50).fill(C.primary);
    doc.fillColor(C.header).font('Helvetica').fontSize(8)
      .text(
        '⚠️ This report is for informational purposes only. Consult a Chartered Accountant for official ITR filing.',
        margin, doc.page.height - 38, { width: contentW, align: 'center' }
      );
    doc.text('Generated by KharchaAI — Your Personal Finance Assistant', margin, doc.page.height - 26,
      { width: contentW, align: 'center' });

    doc.end();

    stream.on('finish', () => resolve(tmpFile));
    stream.on('error',  reject);
  });
}

// ──────────────────────────────────────────────────────────
// PDF DRAWING HELPERS
// ──────────────────────────────────────────────────────────

function sectionHeader(doc, title, y, pageW, margin, C) {
  doc.rect(margin, y, pageW - margin * 2, 22).fill(C.accent);
  doc.fillColor(C.header).font('Helvetica-Bold').fontSize(10)
    .text(title, margin + 8, y + 6);
  return y + 22;
}

function drawTable(doc, headers, rows, startY, margin, contentW, C, colWidths) {
  const ROW_H    = 20;
  const HEADER_H = 22;
  let y          = startY;

  // Default equal column widths
  if (!colWidths) {
    const w = contentW / headers.length;
    colWidths = headers.map(() => w);
  }

  // Header row
  doc.rect(margin, y, contentW, HEADER_H).fill(C.primary);
  let x = margin;
  for (let i = 0; i < headers.length; i++) {
    doc.fillColor(C.header).font('Helvetica-Bold').fontSize(9)
      .text(headers[i], x + 5, y + 6, { width: colWidths[i] - 10 });
    x += colWidths[i];
  }
  y += HEADER_H;

  // Data rows
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const bg  = r % 2 === 0 ? '#FAFAFA' : '#FFFFFF';
    doc.rect(margin, y, contentW, ROW_H).fill(bg);

    x = margin;
    for (let c = 0; c < row.length; c++) {
      doc.fillColor(C.text).font('Helvetica').fontSize(9)
        .text(String(row[c]), x + 5, y + 5, { width: colWidths[c] - 10 });
      x += colWidths[c];
    }

    // Row border
    doc.rect(margin, y, contentW, ROW_H).stroke(C.border);
    y += ROW_H;
  }

  return y;
}

function getAY(fy) {
  const [, end] = fy.split('-');
  const startY  = parseInt(fy.split('-')[0]);
  return `${startY + 1}-${String(startY + 2).slice(2)}`;
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtN(n) {
  return Number(n).toLocaleString('en-IN');
}

module.exports = { generateTaxSummaryPDF, deleteTempFile };
