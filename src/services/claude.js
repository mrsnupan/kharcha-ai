const Anthropic = require('@anthropic-ai/sdk');
const { getCategoryIds } = require('../utils/categories');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an expense tracking assistant for Indian households.
Extract expense information from user input.
Input can be in Hindi, English, or Hinglish (mix of Hindi and English).
All amounts are in Indian Rupees (₹). Never use dollar signs.

If the message contains a SINGLE expense or query, return a JSON object:
{
  "type": "single",
  "amount": <number in rupees, no symbols, 0 if not an expense>,
  "category": <one of: ${getCategoryIds().join(', ')}>,
  "description": <clean merchant/item name in English, max 40 chars>,
  "confidence": <number 0-1>,
  "is_expense": <boolean, true if user is logging an expense>,
  "is_query": <boolean, true if user is asking a question about expenses>,
  "query_type": <one of: daily, weekly, monthly, category, comparison, budget, family, null>,
  "query_category": <category id if asking about a specific category, null otherwise>,
  "budget_set": <boolean, true if user is setting a budget>,
  "budget_category": <category id if setting a category budget, "total" for total budget, null if not a budget action>,
  "budget_amount": <number if setting a budget, 0 otherwise>,
  "family_action": <"add_member" | "remove_member" | null>,
  "family_number": <phone number string if adding/removing member e.g. "+919876543210", null otherwise>
}

If the message contains MULTIPLE expenses (e.g. "petrol 500 aur sabzi 300"), return:
{
  "type": "multiple",
  "expenses": [
    { "amount": 500, "category": "transport", "description": "Petrol", "confidence": 0.99 },
    { "amount": 300, "category": "grocery", "description": "Sabzi", "confidence": 0.99 }
  ]
}

Rules:
- "chai 30" → type:single, is_expense:true, amount:30, category:"food", description:"Chai"
- "petrol 500 aur sabzi 300" → type:multiple, expenses array
- "aaj kitna gaya?" → type:single, is_query:true, query_type:"daily"
- "grocery pe kitna?" → type:single, is_query:true, query_type:"category", query_category:"grocery"
- "grocery budget 8000" → type:single, budget_set:true, budget_category:"grocery", budget_amount:8000
- "add family member +919876543210" → type:single, family_action:"add_member", family_number:"+919876543210"
- "remove family member +919876543210" → type:single, family_action:"remove_member", family_number:"+919876543210"
- "unlink +919876543210" → type:single, family_action:"remove_member", family_number:"+919876543210"
- Convert Hindi amounts: "teen sau" → 300, "paanch hazaar" → 5000, "ek lakh" → 100000
- All amounts are in Indian Rupees (₹), never dollars
- Never return anything except valid JSON. No explanations, no markdown.`;

/**
 * Understand expense or query from natural language text (Hindi/English/Hinglish)
 * Returns parsed JSON object
 */
async function understandMessage(text) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text }]
  });

  const raw = response.content[0].text.trim();

  // Strip markdown code fences if model accidentally adds them
  const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    console.error('[Claude] JSON parse failed:', raw);
    return { type: 'single', is_expense: false, is_query: false, confidence: 0 };
  }

  // Normalize — if old format (no type field), treat as single
  if (!parsed.type) parsed.type = 'single';

  return parsed;
}

/**
 * Generate a natural language summary/response for a query result.
 * Used when we need Claude to compose a friendly reply.
 */
async function generateReply(prompt) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: `You are KharchaAI, a friendly expense tracking assistant for Indian households.
Reply in the same language the user uses (Hindi, English, or Hinglish).
Keep replies short, friendly, and use emojis. No technical jargon.
Always use ₹ (Indian Rupee symbol) for amounts, never use $.`,
    messages: [{ role: 'user', content: prompt }]
  });
  return response.content[0].text.trim();
}

module.exports = { understandMessage, generateReply };
