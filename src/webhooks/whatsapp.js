const express = require('express');
const router = express.Router();

const { findOrCreateUser, addFamilyMember } = require('../models/user');
const { understandMessage } = require('../services/claude');
const { transcribeVoiceMessage } = require('../services/whisper');
const { logExpense, handleQuery, handleSetBudget } = require('../services/expenses');
const { sendMessage } = require('../services/whatsapp');
const { formatVoiceConfirmation } = require('../utils/formatter');
const twilioValidate = require('../middleware/twilioValidate');
const { maskPhone } = require('../middleware/validate');

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

👨‍👩‍👧 *Family add karne ke liye:*
• add family member +91XXXXXXXXXX

📱 *Bank SMS auto-track ke liye:*
• "app install karo" likhke app link pao`;
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
