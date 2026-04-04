const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER; // "whatsapp:+14155238886"

/**
 * Send a WhatsApp message to a phone number.
 * toNumber should include "whatsapp:" prefix or we add it.
 */
async function sendMessage(toNumber, messageBody) {
  const to = toNumber.startsWith('whatsapp:') ? toNumber : `whatsapp:${toNumber}`;

  try {
    const msg = await client.messages.create({
      from: FROM_NUMBER,
      to,
      body: messageBody
    });
    console.log(`[WhatsApp] Sent to ${to}: ${msg.sid}`);
    return msg;
  } catch (err) {
    console.error(`[WhatsApp] Send failed to ${to}:`, err.message);
    throw err;
  }
}

module.exports = { sendMessage };
