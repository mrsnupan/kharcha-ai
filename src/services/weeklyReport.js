const cron = require('node-cron');
const supabase = require('../models/db');
const { sendMessage } = require('./whatsapp');
const { getIncomeVsExpense } = require('../models/income');

// Day names for display
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_NAMES_HI = ['Ravivar', 'Somvar', 'Mangalvar', 'Budhvar', 'Guruvar', 'Shukravar', 'Shanivar'];

// ──────────────────────────────────────────────────────────
// REPORT GENERATOR
// ──────────────────────────────────────────────────────────

/**
 * Generate and send weekly report to a single user.
 */
async function sendWeeklyReport(user) {
  try {
    const now  = new Date();
    const month = now.getMonth() + 1;
    const year  = now.getFullYear();

    // Get this week's date range (last 7 days)
    const weekEnd   = new Date();
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    weekEnd.setHours(23, 59, 59, 999);

    // ── Weekly expenses ──
    const { data: weekExpenses } = await supabase
      .from('expenses')
      .select('amount, category, description, transaction_date')
      .eq('user_id', user.id)
      .gte('transaction_date', weekStart.toISOString())
      .lte('transaction_date', weekEnd.toISOString());

    const expenses = weekExpenses || [];
    const totalExpense = expenses.reduce((s, e) => s + Number(e.amount), 0);

    // ── Category breakdown ──
    const byCategory = {};
    for (const e of expenses) {
      byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
    }
    const topCategories = Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);

    // ── Weekly income ──
    const { data: weekIncomes } = await supabase
      .from('incomes')
      .select('amount, category')
      .eq('user_id', user.id)
      .gte('transaction_date', weekStart.toISOString())
      .lte('transaction_date', weekEnd.toISOString());

    const totalIncome  = (weekIncomes || []).reduce((s, i) => s + Number(i.amount), 0);
    const weeklySaving = totalIncome - totalExpense;

    // ── Monthly savings (full month so far) ──
    const monthlySummary = await getIncomeVsExpense(user.id, month, year);

    // ── Khata outstanding ──
    const { data: khataData } = await supabase
      .from('khata_customers')
      .select('total_due')
      .eq('owner_id', user.id)
      .gt('total_due', 0);

    const totalKhata = (khataData || []).reduce((s, k) => s + Number(k.total_due), 0);

    // ── Budget alerts ──
    const { data: budgets } = await supabase
      .from('budgets')
      .select('category, monthly_limit')
      .eq('user_id', user.id)
      .eq('month', month)
      .eq('year', year);

    const budgetWarnings = [];
    for (const b of (budgets || [])) {
      const spent = byCategory[b.category] || 0;
      const limit = Number(b.monthly_limit);
      const pct   = Math.round((spent / limit) * 100);
      if (pct >= 80) {
        budgetWarnings.push(`⚠️ ${b.category} budget: ${pct}% used`);
      }
    }

    // ── Build message ──
    const weekLabel = `${formatDate(weekStart)} – ${formatDate(weekEnd)}`;
    const greeting  = getGreeting(user.name);

    let msg = `${greeting}\n\n`;
    msg += `📅 *Weekly Report*\n_${weekLabel}_\n\n`;

    // Expense section
    msg += `💸 *Is Hafte ka Kharcha:* ₹${fmt(totalExpense)}\n`;
    if (topCategories.length > 0) {
      for (const [cat, amt] of topCategories) {
        const bar = makeBar(amt, totalExpense);
        msg += `  ${getCatEmoji(cat)} ${capitalize(cat)}: ₹${fmt(amt)} ${bar}\n`;
      }
    } else {
      msg += `  _Koi kharcha nahi is hafte_ 🎉\n`;
    }

    // Income section (only if logged)
    if (totalIncome > 0) {
      msg += `\n💰 *Is Hafte ki Income:* ₹${fmt(totalIncome)}\n`;
      msg += `✅ *Weekly Savings:* ₹${fmt(Math.abs(weeklySaving))}`;
      msg += weeklySaving >= 0 ? ' 🎉\n' : ' _(overspent)_ ⚠️\n';
    }

    // Monthly savings
    if (monthlySummary.totalIncome > 0) {
      const savPct = Math.round((monthlySummary.savings / monthlySummary.totalIncome) * 100);
      msg += `\n📊 *Month so far:*\n`;
      msg += `  Income: ₹${fmt(monthlySummary.totalIncome)}\n`;
      msg += `  Expense: ₹${fmt(monthlySummary.totalExpense)}\n`;
      msg += `  Savings: ₹${fmt(Math.abs(monthlySummary.savings))} (${savPct}%)\n`;
    }

    // Khata outstanding
    if (totalKhata > 0) {
      msg += `\n📒 *Khata Outstanding:* ₹${fmt(totalKhata)}\n`;
      msg += `  _"sabka hisaab" type karo details ke liye_\n`;
    }

    // Budget warnings
    if (budgetWarnings.length > 0) {
      msg += `\n${budgetWarnings.join('\n')}\n`;
    }

    // Footer
    msg += `\n_Next report: ${getNextReportDay(user.report_day)} ${user.report_hour}:00_\n`;
    msg += `_"weekly report band karo" — disable karne ke liye_`;

    await sendMessage(user.whatsapp_number, msg);
    console.log(`[WeeklyReport] Sent to ${user.whatsapp_number}`);

  } catch (err) {
    console.error(`[WeeklyReport] Failed for user ${user.id}:`, err.message);
  }
}

// ──────────────────────────────────────────────────────────
// CRON RUNNER — fires every hour, IST
// Checks which users are due for their weekly report
// ──────────────────────────────────────────────────────────

function startWeeklyReportCron() {
  // Runs every hour at minute 0 — IST offset handled below
  cron.schedule('0 * * * *', async () => {
    try {
      // Current time in IST (UTC+5:30)
      const utcNow   = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000;
      const istNow   = new Date(utcNow.getTime() + istOffset);
      const istDay   = istNow.getDay();   // 0=Sun...6=Sat
      const istHour  = istNow.getHours(); // 0–23

      console.log(`[WeeklyReport] Cron tick — IST day:${istDay} hour:${istHour}`);

      // Find all users whose report is due right now
      const { data: users, error } = await supabase
        .from('users')
        .select('*')
        .eq('report_day', istDay)
        .eq('report_hour', istHour)
        .eq('report_enabled', true);

      if (error) {
        console.error('[WeeklyReport] DB error:', error.message);
        return;
      }

      if (!users || users.length === 0) {
        console.log('[WeeklyReport] No users due at this time');
        return;
      }

      console.log(`[WeeklyReport] Sending to ${users.length} user(s)`);
      for (const user of users) {
        await sendWeeklyReport(user);
        // Small delay between sends to avoid rate limits
        await sleep(1000);
      }
    } catch (err) {
      console.error('[WeeklyReport] Cron error:', err.message);
    }
  }, {
    timezone: 'UTC' // We handle IST offset manually above
  });

  console.log('[WeeklyReport] Cron started — checks every hour');
}

// ──────────────────────────────────────────────────────────
// USER PREFERENCE UPDATER
// ──────────────────────────────────────────────────────────

/**
 * Save user's report schedule preference.
 * day: 0–6 (Sun–Sat), hour: 0–23
 */
async function setReportSchedule(userId, day, hour, enabled = true) {
  const { error } = await supabase
    .from('users')
    .update({ report_day: day, report_hour: hour, report_enabled: enabled })
    .eq('id', userId);

  if (error) throw error;
}

/**
 * Disable weekly report for a user.
 */
async function disableReport(userId) {
  const { error } = await supabase
    .from('users')
    .update({ report_enabled: false })
    .eq('id', userId);
  if (error) throw error;
}

// ──────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n).toLocaleString('en-IN');
}

function formatDate(d) {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function makeBar(part, total) {
  if (!total) return '';
  const pct = part / total;
  const filled = Math.round(pct * 5);
  return '█'.repeat(Math.min(filled, 5)) + '░'.repeat(Math.max(5 - filled, 0));
}

function getCatEmoji(cat) {
  const map = {
    food: '🍔', grocery: '🛒', transport: '🚗', health: '💊',
    entertainment: '🎬', shopping: '🛍️', utility: '💡',
    education: '📚', rent: '🏠', other: '📦'
  };
  return map[cat] || '📦';
}

function getGreeting(name) {
  const greetings = [
    `Namaste${name ? ` *${name}*` : ''}! 🙏`,
    `Good Morning${name ? ` *${name}*` : ''}! ☀️`,
    `Jai ho${name ? ` *${name}*` : ''}! 😊`
  ];
  return greetings[Math.floor(Math.random() * greetings.length)];
}

function getNextReportDay(reportDay) {
  return DAY_NAMES[reportDay] || 'Sunday';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse day name from text (Hindi or English).
 * Returns 0–6 or null.
 */
function parseDayName(text) {
  const t = text.toLowerCase().trim();
  const days = {
    // English
    sunday: 0, sun: 0,
    monday: 1, mon: 1,
    tuesday: 2, tue: 2,
    wednesday: 3, wed: 3,
    thursday: 4, thu: 4,
    friday: 5, fri: 5,
    saturday: 6, sat: 6,
    // Hindi
    ravivar: 0, ravi: 0,
    somvar: 1, som: 1,
    mangalvar: 2, mangal: 2,
    budhvar: 3, budh: 3,
    guruvar: 4, guru: 4, brihaspativar: 4,
    shukravar: 5, shukra: 5,
    shanivar: 6, shani: 6
  };
  for (const [key, val] of Object.entries(days)) {
    if (t.includes(key)) return val;
  }
  return null;
}

/**
 * Parse hour from text like "8 am", "9 baje", "20:00", "evening 6"
 * Returns 0–23 or null.
 */
function parseHour(text) {
  const t = text.toLowerCase();

  // "8 am" / "8am"
  const amMatch = t.match(/(\d{1,2})\s*am/);
  if (amMatch) {
    const h = parseInt(amMatch[1]);
    return h === 12 ? 0 : h;
  }

  // "8 pm" / "8pm"
  const pmMatch = t.match(/(\d{1,2})\s*pm/);
  if (pmMatch) {
    const h = parseInt(pmMatch[1]);
    return h === 12 ? 12 : h + 12;
  }

  // "8 baje" / "9 baje"
  const bajeMatch = t.match(/(\d{1,2})\s*baje/);
  if (bajeMatch) return parseInt(bajeMatch[1]); // assume AM for baje

  // "20:00"
  const timeMatch = t.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) return parseInt(timeMatch[1]);

  // Plain number (e.g. "at 8")
  const numMatch = t.match(/at\s+(\d{1,2})/);
  if (numMatch) return parseInt(numMatch[1]);

  return null;
}

module.exports = {
  startWeeklyReportCron,
  sendWeeklyReport,
  setReportSchedule,
  disableReport,
  parseDayName,
  parseHour,
  DAY_NAMES,
  DAY_NAMES_HI
};
