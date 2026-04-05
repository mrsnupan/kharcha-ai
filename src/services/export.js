const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const path = require('path');
const os = require('os');
const fs = require('fs');

// ──────────────────────────────────────────────────────────
// EXCEL EXPORT
// ──────────────────────────────────────────────────────────

/**
 * Generate Excel file for a single customer's history.
 * Returns file path (temp file).
 */
async function exportCustomerExcel(customer, entries) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'KharchaAI';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(`${customer.name} - Khata`);

  // Header info
  sheet.mergeCells('A1:E1');
  sheet.getCell('A1').value = `Khata: ${customer.name}`;
  sheet.getCell('A1').font = { bold: true, size: 14 };

  sheet.mergeCells('A2:E2');
  sheet.getCell('A2').value = `Mobile: ${customer.mobile || 'N/A'}`;

  sheet.mergeCells('A3:E3');
  const due = Number(customer.total_due || 0);
  sheet.getCell('A3').value = `Outstanding Balance: ₹${due.toFixed(2)}`;
  sheet.getCell('A3').font = { bold: true, color: { argb: due > 0 ? 'FFCC0000' : 'FF006600' } };

  sheet.addRow([]);

  // Column headers
  const headerRow = sheet.addRow(['Date', 'Type', 'Amount (₹)', 'Description', 'Running Balance']);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } };
    cell.alignment = { horizontal: 'center' };
  });

  sheet.columns = [
    { key: 'date',    width: 18 },
    { key: 'type',    width: 12 },
    { key: 'amount',  width: 14 },
    { key: 'desc',    width: 30 },
    { key: 'balance', width: 16 },
  ];

  // Data rows with running balance
  let runningBalance = 0;
  const sorted = [...entries].sort((a, b) => new Date(a.entry_date) - new Date(b.entry_date));

  for (const entry of sorted) {
    const amt = Number(entry.amount);
    runningBalance += entry.type === 'credit' ? amt : -amt;

    const row = sheet.addRow({
      date:    formatDate(entry.entry_date),
      type:    entry.type === 'credit' ? 'Credit (Diya)' : 'Payment (Liya)',
      amount:  amt.toFixed(2),
      desc:    entry.description || '',
      balance: runningBalance.toFixed(2),
    });

    row.getCell('type').font = {
      color: { argb: entry.type === 'credit' ? 'FFCC0000' : 'FF006600' }
    };
    row.getCell('balance').font = {
      bold: true,
      color: { argb: runningBalance > 0 ? 'FFCC0000' : 'FF006600' }
    };
  }

  // Summary row
  sheet.addRow([]);
  const totalCredit  = sorted.filter(e => e.type === 'credit').reduce((s, e) => s + Number(e.amount), 0);
  const totalPayment = sorted.filter(e => e.type === 'payment').reduce((s, e) => s + Number(e.amount), 0);
  sheet.addRow(['', 'Total Credit:', totalCredit.toFixed(2), '', '']);
  sheet.addRow(['', 'Total Payment:', totalPayment.toFixed(2), '', '']);
  sheet.addRow(['', 'Net Due:', due.toFixed(2), '', '']);

  const filePath = path.join(os.tmpdir(), `khata_${customer.name}_${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

/**
 * Generate Excel for full ledger (all customers).
 */
async function exportFullLedgerExcel(ownerName, customers) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'KharchaAI';

  const sheet = workbook.addWorksheet('Full Khata');

  sheet.mergeCells('A1:D1');
  sheet.getCell('A1').value = `Poora Khata — ${ownerName || 'My Shop'}`;
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  sheet.mergeCells('A2:D2');
  sheet.getCell('A2').value = `Generated: ${formatDate(new Date())}`;

  sheet.addRow([]);

  const headerRow = sheet.addRow(['Customer Name', 'Mobile', 'Outstanding (₹)', 'Since']);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } };
    cell.alignment = { horizontal: 'center' };
  });

  sheet.columns = [
    { key: 'name',    width: 24 },
    { key: 'mobile',  width: 18 },
    { key: 'due',     width: 18 },
    { key: 'since',   width: 18 },
  ];

  let grandTotal = 0;
  for (const c of customers) {
    const due = Number(c.total_due || 0);
    grandTotal += due;
    const row = sheet.addRow({
      name:   c.name,
      mobile: c.mobile || 'N/A',
      due:    due.toFixed(2),
      since:  formatDate(c.created_at),
    });
    row.getCell('due').font = {
      bold: true,
      color: { argb: due > 0 ? 'FFCC0000' : 'FF006600' }
    };
  }

  sheet.addRow([]);
  const totalRow = sheet.addRow(['', 'TOTAL OUTSTANDING', grandTotal.toFixed(2), '']);
  totalRow.getCell('B').font = { bold: true };
  totalRow.getCell('C').font = { bold: true, color: { argb: 'FFCC0000' } };

  const filePath = path.join(os.tmpdir(), `full_khata_${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

// ──────────────────────────────────────────────────────────
// PDF EXPORT
// ──────────────────────────────────────────────────────────

/**
 * Generate PDF for a customer's history.
 */
async function exportCustomerPDF(customer, entries) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(os.tmpdir(), `khata_${customer.name}_${Date.now()}.pdf`);
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Header
    doc.fontSize(18).fillColor('#1B5E20').text(`Khata: ${customer.name}`, { align: 'center' });
    doc.fontSize(11).fillColor('#555').text(`Mobile: ${customer.mobile || 'N/A'}`, { align: 'center' });
    doc.moveDown(0.5);

    const due = Number(customer.total_due || 0);
    doc.fontSize(13).fillColor(due > 0 ? '#CC0000' : '#006600')
      .text(`Outstanding: ₹${due.toFixed(2)}`, { align: 'center' });
    doc.moveDown(1);

    // Table header
    drawTableHeader(doc, ['Date', 'Type', 'Amount', 'Description', 'Balance']);

    // Rows
    let runningBalance = 0;
    const sorted = [...entries].sort((a, b) => new Date(a.entry_date) - new Date(b.entry_date));

    for (const entry of sorted) {
      const amt = Number(entry.amount);
      runningBalance += entry.type === 'credit' ? amt : -amt;
      drawTableRow(doc, [
        formatDate(entry.entry_date),
        entry.type === 'credit' ? 'Diya' : 'Liya',
        `Rs.${amt.toFixed(2)}`,
        (entry.description || '').slice(0, 30),
        `Rs.${runningBalance.toFixed(2)}`,
      ], entry.type === 'credit' ? '#FFEBEE' : '#E8F5E9');
    }

    // Footer
    doc.moveDown(1);
    doc.fontSize(10).fillColor('#888')
      .text(`Generated by KharchaAI • ${formatDate(new Date())}`, { align: 'center' });

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

/**
 * Generate PDF for full ledger.
 */
async function exportFullLedgerPDF(ownerName, customers) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(os.tmpdir(), `full_khata_${Date.now()}.pdf`);
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(18).fillColor('#1B5E20').text(`Poora Khata`, { align: 'center' });
    doc.fontSize(11).fillColor('#555').text(ownerName || 'My Shop', { align: 'center' });
    doc.fontSize(10).fillColor('#888').text(`Generated: ${formatDate(new Date())}`, { align: 'center' });
    doc.moveDown(1);

    drawTableHeader(doc, ['Name', 'Mobile', 'Outstanding', 'Since']);

    let grandTotal = 0;
    for (const c of customers) {
      const due = Number(c.total_due || 0);
      grandTotal += due;
      drawTableRow(doc, [
        c.name,
        c.mobile || 'N/A',
        `Rs.${due.toFixed(2)}`,
        formatDate(c.created_at),
      ], due > 0 ? '#FFEBEE' : '#FFFFFF');
    }

    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#CC0000')
      .text(`Total Outstanding: Rs.${grandTotal.toFixed(2)}`, { align: 'right' });

    doc.moveDown(1);
    doc.fontSize(10).fillColor('#888')
      .text(`Generated by KharchaAI • ${formatDate(new Date())}`, { align: 'center' });

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

// ──────────────────────────────────────────────────────────
// PDF drawing helpers
// ──────────────────────────────────────────────────────────
function drawTableHeader(doc, cols) {
  doc.fontSize(9).fillColor('#FFFFFF');
  const y = doc.y;
  doc.rect(40, y, 515, 18).fill('#1B5E20');
  const colW = 515 / cols.length;
  cols.forEach((col, i) => {
    doc.fillColor('#FFFFFF').text(col, 42 + i * colW, y + 4, { width: colW - 4, align: 'left' });
  });
  doc.moveDown(1.2);
}

function drawTableRow(doc, cols, bgColor = '#FFFFFF') {
  const y = doc.y;
  doc.rect(40, y - 2, 515, 16).fill(bgColor);
  const colW = 515 / cols.length;
  doc.fontSize(8).fillColor('#212121');
  cols.forEach((col, i) => {
    doc.text(String(col), 42 + i * colW, y, { width: colW - 4, align: 'left' });
  });
  doc.moveDown(0.9);
}

// ──────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────
function formatDate(date) {
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

/**
 * Clean up temp file after sending.
 */
function deleteTempFile(filePath) {
  try { fs.unlinkSync(filePath); } catch {}
}

module.exports = {
  exportCustomerExcel,
  exportFullLedgerExcel,
  exportCustomerPDF,
  exportFullLedgerPDF,
  deleteTempFile,
};
