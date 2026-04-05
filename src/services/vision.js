/**
 * Vision Service — Receipt / Bill Photo Analysis
 * Uses OpenAI GPT-4o Vision to extract expense items from a photo.
 * User sends a receipt/bill image on WhatsApp → items auto-logged as expenses.
 */

const OpenAI = require('openai');
const axios  = require('axios');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Download image from Twilio media URL (requires auth) and
 * convert it to base64 for OpenAI's vision API.
 */
async function fetchImageAsBase64(mediaUrl) {
  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    auth: {
      username: process.env.TWILIO_ACCOUNT_SID,
      password: process.env.TWILIO_AUTH_TOKEN
    },
    timeout: 15000
  });

  const base64  = Buffer.from(response.data, 'binary').toString('base64');
  const mimeType = response.headers['content-type'] || 'image/jpeg';
  return { base64, mimeType };
}

/**
 * Analyze a receipt/bill image and return structured expense data.
 *
 * Returns:
 * {
 *   items: [{ description, amount, category }],
 *   total: number,
 *   merchantName: string,
 *   date: string | null,
 *   rawText: string
 * }
 */
async function extractReceiptData(mediaUrl) {
  let imageContent;

  try {
    const { base64, mimeType } = await fetchImageAsBase64(mediaUrl);
    imageContent = {
      type:       'image_url',
      image_url:  { url: `data:${mimeType};base64,${base64}` }
    };
  } catch (err) {
    console.error('[Vision] Image fetch failed:', err.message);
    throw new Error('Receipt image download kar nahi paya.');
  }

  const systemPrompt = `You are an expense extraction assistant for Indian households.
Analyze the receipt or bill image and extract all expense items.
Always respond in valid JSON. All amounts in Indian Rupees (₹), no dollar signs.
Categories: food, grocery, transport, health, entertainment, shopping, utility, education, rent, other.`;

  const userPrompt = `Look at this receipt/bill image.
Extract ALL items with their amounts.
Return ONLY valid JSON in this format:
{
  "merchant_name": "store/restaurant name or null",
  "date": "DD-MM-YYYY or null",
  "items": [
    { "description": "item name", "amount": 150.00, "category": "food" }
  ],
  "total": 350.00,
  "confidence": 0.9,
  "note": "any important notes, or null"
}
If this is not a receipt/bill, return: { "error": "Not a receipt" }
Keep descriptions short (max 30 chars). Merge small items into one if there are more than 5.`;

  try {
    const response = await openai.chat.completions.create({
      model:      'gpt-4o-mini',
      max_tokens: 600,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            imageContent,
            { type: 'text', text: userPrompt }
          ]
        }
      ]
    });

    const raw     = response.choices[0].message.content.trim();
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[Vision] JSON parse error:', raw);
      throw new Error('Receipt data parse nahi hua.');
    }

    if (parsed.error) {
      throw new Error(parsed.error);
    }

    return parsed;

  } catch (err) {
    if (err.message.includes('parse') || err.message.includes('Not a receipt')) throw err;
    console.error('[Vision] OpenAI error:', err.message);
    throw new Error('Receipt analyze nahi hua. Dobara try karo.');
  }
}

module.exports = { extractReceiptData };
