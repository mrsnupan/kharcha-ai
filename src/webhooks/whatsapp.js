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
  exportCustomerExcel, exportFullLedgerExcel,
  exportCustomerPDF, exportFullLedgerPDF, deleteTempFile
} = require('../services/export');

const MAX_MESSAGE_LENGTH = 1000; // prevent prompt injection via huge messages

/**
 * POST /webhook/whatsapp
 * Twilio sends all WhatsApp messages here.
 * Protected by Twilio signature validation — rejects forged requests.
 */
router.use(twilioValidate);
router.post('/', async (req, res) => {
  // Respond 200 immediately so Twilio doesn't retry
  res.sendStatus(200);

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
  let transcript;
  try {
    transcript = await transcribeVoiceMessage(mediaUrl);
  } catch (err) {
    console.error('[Whisper error]', err.message);
    await sendMessage(fromNumber, "Voice message sun nahi paya 😢 Please text mein likhkar bhejo.");
    return;
  }

  if (!transcript || transcript.length < 2) {
    await sendMessage(fromNumber, "Voice clear nahi thi. Dobara try karo 🎤");
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

function getWelcomeMessage() {
  const apkUrl = process.env.APK_DOWNLOAD_URL || 'https://github.com/mrsnupan/kharcha-ai/releases/latest/download/app-release-unsigned.apk';
  return (
    `🎉 *KharchaAI mein aapka swagat hai!*\n\n` +
    `Main aapka personal kharcha assistant hoon 💰\n\n` +
    `*Abhi se shuru karo:*\n` +
    `• "chai 30" — kharcha log karo\n` +
    `• "Bhai ko 2000 diye" — udhaar track karo\n` +
    `• "500 ka saman Ashish ko diya" — kirana khata\n` +
    `• "aaj kitna gaya?" — report dekho\n` +
    `• 🎤 Voice message bhi bhej sakte ho!\n\n` +
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
