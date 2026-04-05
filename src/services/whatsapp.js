const twilio = require('twilio');
const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

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

/**
 * Send a file (Excel/PDF) as a WhatsApp media message.
 * Uploads the file to Twilio's media API, then sends as MMS.
 */
async function sendFile(toNumber, filePath, fileName) {
  const to = toNumber.startsWith('whatsapp:') ? toNumber : `whatsapp:${toNumber}`;

  try {
    // Upload file to Twilio media
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), { filename: fileName });

    const uploadRes = await axios.post(
      `https://mcs.us1.twilio.com/v1/Services/${process.env.TWILIO_ACCOUNT_SID}/Media`,
      form,
      {
        headers: { ...form.getHeaders() },
        auth: {
          username: process.env.TWILIO_ACCOUNT_SID,
          password: process.env.TWILIO_AUTH_TOKEN
        }
      }
    );

    const mediaUrl = uploadRes.data?.links?.content_direct_temporary;

    const msg = await client.messages.create({
      from: FROM_NUMBER,
      to,
      body: `📎 ${fileName}`,
      mediaUrl: [mediaUrl]
    });

    console.log(`[WhatsApp] File sent to ${to}: ${msg.sid}`);
    return msg;
  } catch (err) {
    console.error(`[WhatsApp] File send failed:`, err.message);
    // Fallback: send a text message with instructions
    await sendMessage(toNumber, `❌ File attach karne mein problem aayi.\nRailway par file upload temporarily unavailable hai. Text history ke liye "history" type karo.`);
  }
}

module.exports = { sendMessage, sendFile };
