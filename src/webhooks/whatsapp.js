const express = require('express');
const router = express.Router();

const { findOrCreateUser, addFamilyMember, removeFamilyMember } = require('../models/user');
const { understandMessage } = require('../services/claude');
const { transcribeVoiceMessage } = require('../services/whisper');
const { logExpense, handleQuery, handleSetBudget } = require('../services/expenses');
const { sendMessage, sendFile } = require('../services/whatsapp');
const { formatVoiceConfirmation } = require('../utils/formatter');
const twilioValidate = require('../middleware/twilioValidate');
const { maskPhone } = require('../middleware/validate');
const {
  findOrCreateCustomer, findCustomerByName,
  addEntry, getCustomerHistory, getLedgerSummary, getTotalOutstanding
} = require('../models/khata');
const {
  logIncome, getIncomeVsExpense, formatIncomeVsExpense
} = require('../models/income');
const {
  setReportSchedule, disableReport,
  parseDayName, parseHour, DAY_NAMES
} = require('../services/weeklyReport');
const {
  exportCustomerExcel, exportFullLedgerExcel,
  exportCustomerPDF, exportFullLedgerPDF, deleteTempFile
} = require('../services/export');
const {
  addEmi, listEmis, findEmiByName, updateEmiStatus,
  scheduleEmiReminder, scheduleAllEmiReminders,
  getNextDueDate, formatEmiList
} = require('../models/emi');
const {
  addGoal, listGoals, findGoalByName, addToGoal,
  formatGoalProgress, formatGoalsList
} = require('../models/savings');
const { listReminders } = require('../services/reminderCron');
const { extractReceiptData } = require('../services/vision');

const MAX_MESSAGE_LENGTH = 1000; // prevent prompt injection via huge messages

/**
 * POST /webhook/whatsapp
 * Twilio sends all WhatsApp messages here.
 * Protected by Twilio signature validation — rejects forged requests.
 */
router.use(twilioValidate);
router.post('/', async (req, res) => {
  // Respond 200 immediately so Twilio doesn't retry
  // Use .end() — sendStatus(200) sends "OK" body which Twilio relays as a message
  res.status(200).end();

  const body = req.body;
  const fromNumber = body.From;       // "whatsapp:+919876543210"
  const numMedia = parseInt(body.NumMedia || '0', 10);
  const mediaContentType = body.MediaContentType0 || '';
  const mediaUrl = body.MediaUrl0 || '';

  // Truncate message to prevent prompt injection and DoS
  const messageBody = (body.Body || '').trim().slice(0, MAX_MESSAGE_LENGTH);

  if (!fromNumber) return;

  // PII-safe log — never log full phone or message content
  console.log(`[WhatsApp] From: ${maskPhone(fromNumber)} | Len: ${messageBody.length} | Media: ${numMedia}`);

  try {
    const user = await findOrCreateUser(fromNumber);

    // ── New user — send welcome + app install link first ──
    if (user._isNew) {
      await sendMessage(fromNumber, getWelcomeMessage());
      return;
    }

    // ── Receipt / bill photo ──
    if (numMedia > 0 && mediaContentType.startsWith('image/')) {
      await handleReceiptPhoto(user, fromNumber, mediaUrl);
      return;
    }

    // ── Voice message ──
    if (numMedia > 0 && mediaContentType.startsWith('audio/')) {
      await handleVoiceMessage(user, fromNumber, mediaUrl);
      return;
    }

    // ── Text message ──
    if (messageBody) {
      await handleTextMessage(user, fromNumber, messageBody);
      return;
    }

    await sendMessage(fromNumber, "Kuch samajh nahi aaya. Text ya voice message bhejo 😊");
  } catch (err) {
    console.error('[WhatsApp webhook error]', err);
    try {
      await sendMessage(fromNumber, "Kuch gadbad ho gayi. Thodi der baad try karo 🙏");
    } catch (_) {}
  }
});

// ──────────────────────────────────────────────────────────
// Text message handler
// ──────────────────────────────────────────────────────────
async function handleTextMessage(user, fromNumber, text) {
  // Quick commands (no Claude needed)
  const lower = text.toLowerCase().trim();

  if (lower === 'help' || lower === 'hi' || lower === 'hello' || lower === 'helo') {
    await sendMessage(fromNumber, getHelpMessage());
    return;
  }

  if (lower.includes('app install') || lower.includes('app link') || lower === 'app') {
    await sendMessage(fromNumber, getAppInstallMessage());
    return;
  }

  // Ask Claude to understand the message
  const parsed = await understandMessage(text);
  console.log('[Claude parsed]', JSON.stringify(parsed));

  // ── Family action ──
  if (parsed.family_action === 'add_member' && parsed.family_number) {
    const member = await addFamilyMember(user.id, parsed.family_number);
    await sendMessage(fromNumber,
      `✅ ${parsed.family_number} ko family mein add kar diya! 👨‍👩‍👧‍👦\nAb unka number bhi KharchaAI se connect ho jayega.`
    );
    return;
  }

  if (parsed.family_action === 'remove_member' && parsed.family_number) {
    try {
      await removeFamilyMember(user.id, parsed.family_number);
      await sendMessage(fromNumber,
        `✅ ${parsed.family_number} ko family se remove kar diya.\nUnka data alag ho gaya hai.`
      );
    } catch (e) {
      await sendMessage(fromNumber, `❌ ${e.message}`);
    }
    return;
  }

  // ── Weekly report schedule ──
  if (parsed.report_disable) {
    await disableReport(user.id);
    await sendMessage(fromNumber,
      `🔕 *Weekly report band kar diya.*\n\n` +
      `Dobara shuru karne ke liye:\n` +
      `_"weekly report Monday 8 am set karo"_`
    );
    return;
  }

  if (parsed.report_schedule_set) {
    const rawText = text || '';
    // Try Claude's parsed values first, fallback to regex parsing
    const day  = parsed.report_day  != null ? parseDayName(parsed.report_day) : parseDayName(rawText);
    const hour = parsed.report_hour != null ? Number(parsed.report_hour)       : parseHour(rawText);

    const finalDay  = day  ?? 0; // default Sunday
    const finalHour = hour ?? 8; // default 8am

    await setReportSchedule(user.id, finalDay, finalHour, true);

    const dayName  = DAY_NAMES[finalDay];
    const hourStr  = finalHour < 12
      ? `${finalHour === 0 ? 12 : finalHour}:00 AM`
      : `${finalHour === 12 ? 12 : finalHour - 12}:00 PM`;

    await sendMessage(fromNumber,
      `✅ *Weekly report schedule set!*\n\n` +
      `📅 Din: *${dayName}*\n` +
      `🕐 Time: *${hourStr} IST*\n\n` +
      `Har ${dayName} ko ${hourStr} pe aapko weekly summary milegi automatically.\n\n` +
      `_"weekly report band karo" — disable karne ke liye_`
    );
    return;
  }

  // ── Income logging ──
  if (parsed.income_log && parsed.income_amount > 0) {
    const { confirmMsg } = await logIncome({
      userId:      user.id,
      amount:      parsed.income_amount,
      category:    parsed.income_category || 'other',
      description: parsed.income_description || 'Income received',
      source:      'chat'
    });
    await sendMessage(fromNumber, confirmMsg);
    return;
  }

  // ── Income query / savings ──
  if (parsed.income_query) {
    const now = new Date();
    const summary = await getIncomeVsExpense(user.id, now.getMonth() + 1, now.getFullYear());
    const msg = formatIncomeVsExpense({
      ...summary,
      month: now.getMonth() + 1,
      year:  now.getFullYear()
    });
    await sendMessage(fromNumber, msg);
    return;
  }

  // ── Khata (Kirana ledger) actions ──
  if (parsed.khata_action) {
    await handleKhataAction(user, fromNumber, parsed);
    return;
  }

  // ── EMI actions ──
  if (parsed.emi_action) {
    await handleEmiAction(user, fromNumber, parsed);
    return;
  }

  // ── Savings goals ──
  if (parsed.savings_action) {
    await handleSavingsAction(user, fromNumber, parsed);
    return;
  }

  // ── Split calculator ──
  if (parsed.split_total > 0 && parsed.split_count > 1) {
    const perPerson = parsed.split_total / parsed.split_count;
    const desc      = parsed.split_description || 'kharcha';
    await sendMessage(fromNumber,
      `🧮 *Split Calculator*\n\n` +
      `📋 ${capitalize(desc)}: ₹${fmtAmt(parsed.split_total)}\n` +
      `👥 Logon ki sankhya: ${parsed.split_count}\n` +
      `━━━━━━━━━━━━━━\n` +
      `💰 *Har ek ka hissa: ₹${fmtAmt(perPerson)}*\n\n` +
      `_Kisi ne zyada diya toh udhaar track karne ke liye:_\n` +
      `_"Rahul ko 300 dena hai" — khata mein add karo_`
    );
    return;
  }

  // ── Reminders list ──
  if (lower === 'reminders' || lower === 'reminders dikhao' || lower === 'upcoming reminders') {
    await handleListReminders(user, fromNumber);
    return;
  }

  // ── Budget set ──
  if (parsed.budget_set && parsed.budget_amount > 0) {
    const reply = await handleSetBudget({
      userId: user.id,
      category: parsed.budget_category,
      amount: parsed.budget_amount
    });
    await sendMessage(fromNumber, reply);
    return;
  }

  // ── Query ──
  if (parsed.is_query) {
    const reply = await handleQuery(parsed, user.id);
    await sendMessage(fromNumber, reply);
    return;
  }

  // ── Multiple expenses ──
  if (parsed.type === 'multiple' && Array.isArray(parsed.expenses) && parsed.expenses.length > 0) {
    const lines = [];
    for (const exp of parsed.expenses) {
      if (exp.amount > 0) {
        const { confirmMsg } = await logExpense({
          userId: user.id,
          amount: exp.amount,
          category: exp.category,
          description: exp.description,
          source: 'chat',
          rawInput: text,
          toNumber: fromNumber
        });
        lines.push(confirmMsg);
      }
    }
    if (lines.length > 0) {
      await sendMessage(fromNumber, lines.join('\n'));
    }
    return;
  }

  // ── Single expense ──
  if (parsed.is_expense && parsed.amount > 0) {
    const { confirmMsg } = await logExpense({
      userId: user.id,
      amount: parsed.amount,
      category: parsed.category,
      description: parsed.description,
      source: 'chat',
      rawInput: text,
      toNumber: fromNumber
    });
    await sendMessage(fromNumber, confirmMsg);
    return;
  }

  // ── Fallback ──
  await sendMessage(fromNumber,
    "Samajh nahi aaya 🤔\n'chai 30' ya 'aaj kitna gaya?' type karo.\n'help' likhoge toh menu aayega."
  );
}

// ──────────────────────────────────────────────────────────
// Voice message handler
// ──────────────────────────────────────────────────────────
async function handleVoiceMessage(user, fromNumber, mediaUrl) {
  // Send instant feedback so user knows we're processing
  await sendMessage(fromNumber, "🎤 _Sun raha hoon..._");

  let transcript;
  try {
    transcript = await transcribeVoiceMessage(mediaUrl);
  } catch (err) {
    console.error('[Whisper error]', err.message);
    await sendMessage(fromNumber,
      `❌ Voice samajh nahi aaya.\n\n` +
      `_Try karo:_\n` +
      `• Thoda zyada clearly bolo\n` +
      `• Background noise kam karo\n` +
      `• Ya text mein type karo 📝`
    );
    return;
  }

  if (!transcript || transcript.length < 2) {
    await sendMessage(fromNumber, "🎤 Voice clear nahi thi. Dobara try karo ya text mein type karo.");
    return;
  }

  console.log('[Whisper transcript]', transcript);

  // Process transcript same as text
  const parsed = await understandMessage(transcript);

  if (parsed.is_expense && parsed.amount > 0) {
    const { expense } = await logExpense({
      userId: user.id,
      amount: parsed.amount,
      category: parsed.category,
      description: parsed.description,
      source: 'voice',
      rawInput: transcript,
      toNumber: fromNumber
    });
    const reply = formatVoiceConfirmation(transcript, expense);
    await sendMessage(fromNumber, reply);
    return;
  }

  if (parsed.is_query) {
    const reply = await handleQuery(parsed, user.id);
    await sendMessage(fromNumber, `🎤 Suna: '${transcript}'\n\n${reply}`);
    return;
  }

  await sendMessage(fromNumber,
    `🎤 Suna: '${transcript}'\n\nSamajh nahi aaya. Kharcha batao ya koi sawaal poocho 😊`
  );
}

// ──────────────────────────────────────────────────────────
// Help message
// ──────────────────────────────────────────────────────────
function getHelpMessage() {
  return `👋 *KharchaAI mein aapka swagat hai!*

📝 *Kharcha log karne ke liye:*
• chai 30
• petrol 500
• zomato se khana 650
• school fees 15000

🎤 *Voice message bhi bhej sakte ho!*

📊 *Reports ke liye:*
• aaj kitna gaya?
• is hafte ka summary
• monthly report
• grocery pe kitna kharch hua?
• last month vs this month

🎯 *Budget set karne ke liye:*
• grocery budget 8000
• total budget 40000

👨‍👩‍👧 *Family ke liye:*
• add family member +91XXXXXXXXXX
• remove family member +91XXXXXXXXXX

💰 *Income track karo:*
• "aaj salary aayi 45000"
• "freelance ka 8000 mila"
• "rent mila 15000"
• "income vs expense dikhao" / "savings kitna hua"

📆 *Weekly Report:*
• Default: Sunday 8 AM automatic
• "weekly report Monday 9 am set karo"
• "weekly report band karo"

📒 *Khata / Udhaar Tracker:*
_Kirana shop, friends, family — sab ke liye!_
• "500 ka saman Ashish ko diya"
• "Bhai ko 2000 diye" / "Rahul ko udhaar diya 1500"
• "Ashish ne 200 diya" (payment received)
• "Bhai ne 500 waapis kiye"
• "Ashish ka hisaab" (check balance)
• "kisko kitna dena hai" (sabka list)
• "Ashish ko reminder bhejo" (WhatsApp alert)
• "Ashish ki history download karo" (Excel)
• "poora khata download karo" (full list)

🏦 *EMI Track karo:*
• "Home Loan EMI 12000 date 5"
• "Car Loan EMI 8500 har 15 tarikh ko"
• "meri EMI list"
• _Bank SMS se EMI auto-detect hoti hai!_

🎯 *Savings Goals:*
• "Goa trip ke liye 20000 bachana hai"
• "New Phone 15000, 3 mahine mein"
• "Goa trip mein 5000 daalo"
• "meri goals dikhao"

🧮 *Split Calculator:*
• "dinner 1200, hum 4 the"
• "movie 600, 3 log"

📸 *Receipt Auto-log:*
• _Bill/receipt ki photo bhejo — automatically log ho jaayega!_

🔔 *Reminders:*
• "reminders dikhao" — upcoming alerts
• _Jio/Airtel recharge SMS se auto-reminder set hota hai!_

📱 *Bank SMS auto-track ke liye:*
• "app install karo" likhke app link pao`;
}

// ──────────────────────────────────────────────────────────
// KHATA HANDLER
// ──────────────────────────────────────────────────────────
async function handleKhataAction(user, fromNumber, parsed) {
  const action       = parsed.khata_action;
  const customerName = parsed.khata_customer_name;
  const mobile       = parsed.khata_customer_mobile;
  const amount       = Number(parsed.khata_amount || 0);
  const description  = parsed.khata_description || '';

  try {
    // ── Credit: gave goods to customer ──
    if (action === 'credit' && customerName && amount > 0) {
      const { customer, isNew } = await findOrCreateCustomer(user.id, customerName, mobile);
      await addEntry(user.id, customer.id, 'credit', amount, description);
      const newDue = Number(customer.total_due || 0) + amount;
      await sendMessage(fromNumber,
        `✅ *Kharcha logged!*\n\n` +
        `👤 Customer: *${customer.name}*\n` +
        `💸 Diya: ₹${amount.toFixed(2)}\n` +
        `📦 ${description || 'saman'}\n` +
        `━━━━━━━━━━━━━━\n` +
        `📊 Total bakaya: *₹${newDue.toFixed(2)}*` +
        (isNew ? `\n\n_Naya customer add kiya gaya ✨_` : '')
      );
      return;
    }

    // ── Payment: received money from customer ──
    if (action === 'payment' && customerName && amount > 0) {
      const customer = await findCustomerByName(user.id, customerName);
      if (!customer) {
        await sendMessage(fromNumber, `❌ "${customerName}" naam ka koi customer nahi mila.\n"sabka hisaab" type karo list dekhne ke liye.`);
        return;
      }
      await addEntry(user.id, customer.id, 'payment', amount, description || 'payment received');
      const newDue = Math.max(0, Number(customer.total_due || 0) - amount);
      await sendMessage(fromNumber,
        `✅ *Payment received!*\n\n` +
        `👤 Customer: *${customer.name}*\n` +
        `💰 Mila: ₹${amount.toFixed(2)}\n` +
        `━━━━━━━━━━━━━━\n` +
        `📊 Remaining bakaya: *₹${newDue.toFixed(2)}*` +
        (newDue === 0 ? '\n\n🎉 Poora hisaab saaf!' : '')
      );
      return;
    }

    // ── Balance: check a customer's due ──
    if (action === 'balance' && customerName) {
      const customer = await findCustomerByName(user.id, customerName);
      if (!customer) {
        await sendMessage(fromNumber, `❌ "${customerName}" naam ka koi customer nahi mila.`);
        return;
      }
      const due = Number(customer.total_due || 0);
      await sendMessage(fromNumber,
        `📊 *${customer.name} ka Hisaab*\n\n` +
        `📱 Mobile: ${customer.mobile || 'N/A'}\n` +
        `💰 Bakaya: *₹${due.toFixed(2)}*\n` +
        (due > 0 ? `\n_Unhe reminder bhejne ke liye:_\n_"${customer.name} ko reminder bhejo"_` :
          `\n✅ Koi bakaya nahi!`)
      );
      return;
    }

    // ── History: full transaction list for customer ──
    if (action === 'history' && customerName) {
      const customer = await findCustomerByName(user.id, customerName);
      if (!customer) {
        await sendMessage(fromNumber, `❌ "${customerName}" naam ka koi customer nahi mila.`);
        return;
      }
      const entries = await getCustomerHistory(customer.id, 20);
      if (entries.length === 0) {
        await sendMessage(fromNumber, `📭 ${customer.name} ki koi history nahi mili.`);
        return;
      }
      const lines = entries.slice(0, 10).map(e => {
        const sign = e.type === 'credit' ? '🔴 Diya' : '🟢 Liya';
        const d = new Date(e.entry_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        return `${sign} ₹${Number(e.amount).toFixed(0)} — ${e.description || ''} (${d})`;
      });
      await sendMessage(fromNumber,
        `📜 *${customer.name} ki History*\n\n` +
        lines.join('\n') +
        `\n━━━━━━━━━━━━━━\n` +
        `💰 Total bakaya: *₹${Number(customer.total_due).toFixed(2)}*\n\n` +
        `_Download ke liye: "${customer.name} ka PDF"_`
      );
      return;
    }

    // ── List: all customers with balances ──
    if (action === 'list') {
      const customers = await getLedgerSummary(user.id);
      if (customers.length === 0) {
        await sendMessage(fromNumber, `📭 Abhi koi customer nahi hai.\n\n_"500 ka saman Ashish ko diya" se shuru karo_`);
        return;
      }
      const total = await getTotalOutstanding(user.id);
      const lines = customers.map((c, i) => {
        const due = Number(c.total_due || 0);
        return `${i + 1}. *${c.name}* — ₹${due.toFixed(0)}${due === 0 ? ' ✅' : ''}`;
      });
      await sendMessage(fromNumber,
        `👥 *Sabka Hisaab*\n\n` +
        lines.join('\n') +
        `\n━━━━━━━━━━━━━━\n` +
        `💰 Total outstanding: *₹${total.toFixed(2)}*\n\n` +
        `_"poora khata download karo" for Excel/PDF_`
      );
      return;
    }

    // ── Reminder: send WhatsApp to customer ──
    if (action === 'reminder') {
      if (customerName) {
        const customer = await findCustomerByName(user.id, customerName);
        if (!customer) {
          await sendMessage(fromNumber, `❌ "${customerName}" naam ka koi customer nahi mila.`);
          return;
        }
        if (!customer.mobile) {
          await sendMessage(fromNumber, `❌ ${customer.name} ka WhatsApp number save nahi hai.\n_"${customer.name} ka number +91XXXXXXXXXX hai" bhejo pehle_`);
          return;
        }
        const due = Number(customer.total_due || 0);
        if (due <= 0) {
          await sendMessage(fromNumber, `✅ ${customer.name} ka koi bakaya nahi hai — reminder ki zaroorat nahi.`);
          return;
        }
        await sendMessage(`whatsapp:${customer.mobile}`,
          `Namaste *${customer.name}* ji! 🙏\n\n` +
          `Aapka *₹${due.toFixed(2)}* bakaya hai.\n` +
          `Kripya jald se jald chukta karein.\n\n` +
          `_— KharchaAI reminder_`
        );
        await sendMessage(fromNumber, `✅ Reminder bhej diya ${customer.name} ko (${customer.mobile})\n💰 Bakaya: ₹${due.toFixed(2)}`);
      } else {
        // Send reminder to ALL customers with outstanding balance
        const customers = await getLedgerSummary(user.id);
        const withDue = customers.filter(c => Number(c.total_due) > 0 && c.mobile);
        let sent = 0;
        for (const c of withDue) {
          await sendMessage(`whatsapp:${c.mobile}`,
            `Namaste *${c.name}* ji! 🙏\n\n` +
            `Aapka *₹${Number(c.total_due).toFixed(2)}* bakaya hai.\n` +
            `Kripya jald se jald chukta karein.\n\n` +
            `_— KharchaAI reminder_`
          );
          sent++;
        }
        const noPhone = customers.filter(c => Number(c.total_due) > 0 && !c.mobile).length;
        await sendMessage(fromNumber,
          `✅ *${sent} customers ko reminder bheja!*` +
          (noPhone > 0 ? `\n⚠️ ${noPhone} customers ka number nahi hai — unhe skip kiya.` : '')
        );
      }
      return;
    }

    // ── Download: customer PDF/Excel ──
    if (action === 'download_customer' && customerName) {
      const customer = await findCustomerByName(user.id, customerName);
      if (!customer) {
        await sendMessage(fromNumber, `❌ "${customerName}" naam ka koi customer nahi mila.`);
        return;
      }
      const entries = await getCustomerHistory(customer.id, 500);
      await sendMessage(fromNumber, `⏳ ${customer.name} ki history generate ho rahi hai...`);
      const filePath = await exportCustomerExcel(customer, entries);
      await sendFile(fromNumber, filePath, `${customer.name}_khata.xlsx`);
      deleteTempFile(filePath);
      return;
    }

    // ── Download: full ledger ──
    if (action === 'download_all') {
      const customers = await getLedgerSummary(user.id);
      if (customers.length === 0) {
        await sendMessage(fromNumber, `📭 Koi customer nahi hai abhi.`);
        return;
      }
      await sendMessage(fromNumber, `⏳ Poora khata generate ho raha hai...`);
      const filePath = await exportFullLedgerExcel(user.name, customers);
      await sendFile(fromNumber, filePath, `poora_khata.xlsx`);
      deleteTempFile(filePath);
      return;
    }

    // Fallback
    await sendMessage(fromNumber, `❓ Khata command samajh nahi aaya. "help" type karo.`);

  } catch (err) {
    console.error('[Khata] Error:', err.message);
    await sendMessage(fromNumber, `❌ Kuch gadbad ho gayi. Dobara try karo.`);
  }
}

// ──────────────────────────────────────────────────────────
// EMI HANDLER
// ──────────────────────────────────────────────────────────
async function handleEmiAction(user, fromNumber, parsed) {
  const action  = parsed.emi_action;
  const name    = parsed.emi_name;
  const amount  = Number(parsed.emi_amount || 0);
  const dueDay  = Number(parsed.emi_due_day || 0);

  try {
    // ── Add new EMI ──
    if (action === 'add' && name && amount > 0 && dueDay >= 1 && dueDay <= 31) {
      const emi = await addEmi(user.id, name, amount, dueDay);
      await scheduleEmiReminder(user.id, emi);

      const nextDue = getNextDueDate(dueDay);
      const nextStr = nextDue.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

      await sendMessage(fromNumber,
        `✅ *EMI added!*\n\n` +
        `🏦 *${name}*\n` +
        `💰 Amount: ₹${fmtAmt(amount)}\n` +
        `📅 Due: ${dueDay}th of every month\n` +
        `📅 Next due: *${nextStr}*\n` +
        `🔔 2 din pehle reminder milega automatically!\n\n` +
        `_"meri EMI list" — sabki list dekhne ke liye_`
      );
      return;
    }

    // ── List all EMIs ──
    if (action === 'list') {
      const emis = await listEmis(user.id, 'active');
      await sendMessage(fromNumber, formatEmiList(emis));
      return;
    }

    // ── Mark EMI as done/completed ──
    if (action === 'done' && name) {
      const emi = await findEmiByName(user.id, name);
      if (!emi) {
        await sendMessage(fromNumber,
          `❌ "${name}" naam ki koi EMI nahi mili.\n_"meri EMI list" se check karo._`
        );
        return;
      }
      await updateEmiStatus(emi.id, 'completed');
      await sendMessage(fromNumber,
        `✅ *${emi.name}* completed mark kar diya! 🎉\n\n` +
        `_Loan khatam ho gaya? Badhaai ho!_ 🎊`
      );
      return;
    }

    // Missing required fields
    if (action === 'add') {
      await sendMessage(fromNumber,
        `❓ EMI add karne ke liye poori jankari chahiye:\n\n` +
        `_"Home Loan EMI 12000 date 5"_\n` +
        `_"Car Loan EMI 8500 har 15 tarikh ko"_`
      );
      return;
    }

    await sendMessage(fromNumber, `❓ EMI command samajh nahi aaya. "meri EMI list" ya "Home Loan EMI 12000 date 5" try karo.`);

  } catch (err) {
    console.error('[EMI] Error:', err.message);
    await sendMessage(fromNumber, `❌ Kuch gadbad ho gayi. Dobara try karo.`);
  }
}

// ──────────────────────────────────────────────────────────
// SAVINGS GOALS HANDLER
// ──────────────────────────────────────────────────────────
async function handleSavingsAction(user, fromNumber, parsed) {
  const action     = parsed.savings_action;
  const goalName   = parsed.savings_goal_name;
  const target     = Number(parsed.savings_target_amount || 0);
  const addAmount  = Number(parsed.savings_add_amount || 0);
  const deadlineRaw = parsed.savings_deadline || null;

  try {
    // ── Create new goal ──
    if (action === 'add_goal' && goalName && target > 0) {
      // Parse deadline (could be "3 mahine mein", "December", "31-12-2026")
      const deadline = parseDeadline(deadlineRaw);
      const goal = await addGoal(user.id, goalName, target, deadline);

      let msg =
        `🎯 *Savings goal set!*\n\n` +
        `📝 Goal: *${goal.name}*\n` +
        `💰 Target: ₹${fmtAmt(target)}\n`;

      if (deadline) {
        const dStr = new Date(deadline).toLocaleDateString('en-IN', {
          day: '2-digit', month: 'long', year: 'numeric'
        });
        msg += `📅 Deadline: ${dStr}\n`;
      }

      msg +=
        `\n_Amount add karne ke liye:_\n` +
        `_"${goalName} mein 5000 daalo"_`;

      await sendMessage(fromNumber, msg);
      return;
    }

    // ── Add money to a goal ──
    if (action === 'add_money' && addAmount > 0) {
      let goal = null;

      if (goalName) {
        goal = await findGoalByName(user.id, goalName);
      } else {
        // If no goal name given, find the first active goal
        const goals = await listGoals(user.id);
        if (goals.length === 1) goal = goals[0];
      }

      if (!goal) {
        const goals = await listGoals(user.id);
        if (goals.length === 0) {
          await sendMessage(fromNumber,
            `❌ Koi active goal nahi hai.\n_"Goa trip ke liye 20000 bachana hai" se goal banao._`
          );
        } else {
          const names = goals.map(g => `• ${g.name}`).join('\n');
          await sendMessage(fromNumber,
            `❓ Kaun se goal mein daalen?\n\n${names}\n\n` +
            `_"${goals[0].name} mein ${addAmount} daalo" likhein._`
          );
        }
        return;
      }

      const updated = await addToGoal(goal.id, addAmount);
      const progressMsg = formatGoalProgress(updated);

      let msg = `✅ *₹${fmtAmt(addAmount)} save ho gaya!*\n\n${progressMsg}`;
      if (updated.status === 'completed') {
        msg += `\n\n🎉 *Goal achieve ho gayi!* Badhaai ho! 🎊`;
      }

      await sendMessage(fromNumber, msg);
      return;
    }

    // ── List all goals ──
    if (action === 'list') {
      const goals = await listGoals(user.id);
      await sendMessage(fromNumber, formatGoalsList(goals));
      return;
    }

    // ── Check a specific goal's progress ──
    if (action === 'check') {
      let goal = null;
      if (goalName) {
        goal = await findGoalByName(user.id, goalName);
      }
      if (!goal) {
        const goals = await listGoals(user.id);
        if (goals.length === 0) {
          await sendMessage(fromNumber, `❌ Koi savings goal nahi hai. "Goa trip ke liye 20000 bachana hai" se shuru karo.`);
        } else {
          await sendMessage(fromNumber, formatGoalsList(goals));
        }
        return;
      }
      await sendMessage(fromNumber, formatGoalProgress(goal));
      return;
    }

    await sendMessage(fromNumber,
      `❓ Savings command samajh nahi aaya.\n\n` +
      `_"Goa trip ke liye 20000 bachana hai"_\n` +
      `_"Goal mein 5000 daalo"_\n` +
      `_"meri goals dikhao"_`
    );

  } catch (err) {
    console.error('[Savings] Error:', err.message);
    await sendMessage(fromNumber, `❌ Kuch gadbad ho gayi. Dobara try karo.`);
  }
}

// ──────────────────────────────────────────────────────────
// RECEIPT PHOTO HANDLER
// ──────────────────────────────────────────────────────────
async function handleReceiptPhoto(user, fromNumber, mediaUrl) {
  await sendMessage(fromNumber, `📸 Receipt scan ho raha hai... thoda wait karo ⏳`);

  let receiptData;
  try {
    receiptData = await extractReceiptData(mediaUrl);
  } catch (err) {
    console.error('[Vision] extractReceiptData error:', err.message);
    await sendMessage(fromNumber,
      `❌ Receipt read nahi hua.\n\n` +
      `_Try karo:_\n` +
      `• Photo clear aur bright honi chahiye\n` +
      `• Bill text clearly visible hona chahiye\n\n` +
      `Ya manually type karo: "chai 30"`
    );
    return;
  }

  if (!receiptData.items || receiptData.items.length === 0) {
    await sendMessage(fromNumber, `❌ Receipt mein koi items nahi mile. Manually type karo.`);
    return;
  }

  // Log each item as an expense
  const loggedItems = [];
  for (const item of receiptData.items) {
    if (!item.amount || item.amount <= 0) continue;
    try {
      const { confirmMsg } = await logExpense({
        userId:      user.id,
        amount:      item.amount,
        category:    item.category || 'other',
        description: item.description || 'Receipt item',
        source:      'chat',
        rawInput:    null,
        toNumber:    fromNumber
      });
      loggedItems.push({ name: item.description, amount: item.amount });
    } catch (logErr) {
      console.error('[Vision] Log item failed:', logErr.message);
    }
  }

  if (loggedItems.length === 0) {
    await sendMessage(fromNumber, `❌ Koi item log nahi hua. Manually type karo.`);
    return;
  }

  const merchant = receiptData.merchant_name ? `*${receiptData.merchant_name}*` : 'Receipt';
  const itemLines = loggedItems.map(i => `  • ${i.name}: ₹${fmtAmt(i.amount)}`).join('\n');
  const total     = loggedItems.reduce((s, i) => s + i.amount, 0);

  await sendMessage(fromNumber,
    `✅ *Receipt logged!*\n\n` +
    `🏪 ${merchant}\n\n` +
    itemLines +
    `\n━━━━━━━━━━━━━━\n` +
    `💰 Total: *₹${fmtAmt(total)}*\n\n` +
    `_${loggedItems.length} item${loggedItems.length > 1 ? 's' : ''} automatically log ho gaye!_ 🎉`
  );
}

// ──────────────────────────────────────────────────────────
// REMINDERS LIST HANDLER
// ──────────────────────────────────────────────────────────
async function handleListReminders(user, fromNumber) {
  try {
    const reminders = await listReminders(user.id);
    if (reminders.length === 0) {
      await sendMessage(fromNumber,
        `🔔 *Koi upcoming reminder nahi hai.*\n\n` +
        `_EMI add karo:_ "Home Loan EMI 12000 date 5"\n` +
        `_Recharge SMS bhejne par auto-reminder set hoga!_`
      );
      return;
    }

    const lines = reminders.slice(0, 10).map(r => {
      const due   = new Date(r.due_date);
      const dStr  = due.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const days  = Math.ceil((due - new Date()) / (1000 * 60 * 60 * 24));
      const emoji = r.type === 'emi' ? '🏦' : r.type === 'recharge' ? '📱' : '💡';
      const amtStr = r.amount ? ` — ₹${fmtAmt(r.amount)}` : '';
      return `${emoji} *${r.name}*${amtStr}\n   📅 ${dStr} (${days} din mein)`;
    });

    await sendMessage(fromNumber,
      `🔔 *Upcoming Reminders*\n\n` +
      lines.join('\n\n') +
      (reminders.length > 10 ? `\n\n_...aur ${reminders.length - 10} reminders_` : '')
    );
  } catch (err) {
    console.error('[Reminders] List error:', err.message);
    await sendMessage(fromNumber, `❌ Reminders load nahi hue. Dobara try karo.`);
  }
}

// ──────────────────────────────────────────────────────────
// UTILS
// ──────────────────────────────────────────────────────────

function fmtAmt(n) {
  const num = Number(n);
  return Number.isInteger(num) ? num.toLocaleString('en-IN') : num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Parse a deadline string into a YYYY-MM-DD date.
 * Handles: "3 mahine mein", "December", "31-12-2026", etc.
 */
function parseDeadline(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();

  // "X mahine mein" → X months from now
  const mahineMatch = lower.match(/(\d+)\s*mahine/);
  if (mahineMatch) {
    const d = new Date();
    d.setMonth(d.getMonth() + parseInt(mahineMatch[1]));
    return d.toISOString().split('T')[0];
  }

  // "X saal mein" → X years from now
  const saalMatch = lower.match(/(\d+)\s*saal/);
  if (saalMatch) {
    const d = new Date();
    d.setFullYear(d.getFullYear() + parseInt(saalMatch[1]));
    return d.toISOString().split('T')[0];
  }

  // Month name "December", "March" → end of that month this year or next
  const months = { january:1, february:2, march:3, april:4, may:5, june:6,
                   july:7, august:8, september:9, october:10, november:11, december:12,
                   jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  for (const [m, idx] of Object.entries(months)) {
    if (lower.includes(m)) {
      const now = new Date();
      let year  = now.getFullYear();
      if (idx <= now.getMonth() + 1) year++; // already passed this year
      return new Date(year, idx - 1, 28).toISOString().split('T')[0]; // safe end-of-month
    }
  }

  // Direct date "31-12-2026" or "2026-12-31"
  const parsed = new Date(raw.replace(/-/g, '/'));
  if (!isNaN(parsed)) return parsed.toISOString().split('T')[0];

  return null;
}

function getWelcomeMessage() {
  const apkUrl = process.env.APK_DOWNLOAD_URL || 'https://github.com/mrsnupan/kharcha-ai/releases/latest/download/app-release-unsigned.apk';
  return (
    `🎉 *KharchaAI mein aapka swagat hai!*\n\n` +
    `Main aapka personal kharcha assistant hoon 💰\n\n` +
    `*Abhi se shuru karo:*\n` +
    `• "chai 30" — kharcha log karo\n` +
    `• "Bhai ko 2000 diye" — udhaar track karo\n` +
    `• "500 ka saman Ashish ko diya" — kirana khata\n` +
    `• "aaj salary aayi 45000" — income track karo\n` +
    `• "Goa trip ke liye 20000 bachana hai" — savings goal\n` +
    `• "Home Loan EMI 12000 date 5" — EMI reminder\n` +
    `• "dinner 1200, hum 4 the" — split calculator\n` +
    `• 📸 Bill ki photo bhejo — auto log!\n` +
    `• 🎤 Voice message bhi bhej sakte ho!\n` +
    `• "aaj kitna gaya?" — report dekho\n\n` +
    `📱 *Bank SMS automatic track karne ke liye:*\n` +
    `App install karo: ${apkUrl}\n\n` +
    `_"help" likhoge toh poora menu milega_ 😊`
  );
}

function getAppInstallMessage() {
  const apkUrl = process.env.APK_DOWNLOAD_URL || 'https://kharchaai.app/download';
  return (
    `📱 *KharchaAI App Install Karo*\n\n` +
    `Bank SMS automatically track karne ke liye ye app install karo:\n` +
    `👉 ${apkUrl}\n\n` +
    `*Steps:*\n` +
    `1️⃣ Link pe tap karo\n` +
    `2️⃣ App download karo (.apk file)\n` +
    `3️⃣ Install karo (Unknown sources allow karna padega)\n` +
    `4️⃣ App kholke apna number daalo\n` +
    `5️⃣ WhatsApp pe OTP aayega — enter karo\n` +
    `6️⃣ Done! 🎉 Ab bank ka har SMS automatically log hoga\n\n` +
    `_Agar koi problem aaye toh "help" likhke message karo_`
  );
}

module.exports = router;
