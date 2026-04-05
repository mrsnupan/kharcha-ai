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
  "family_number": <phone number string if adding/removing member e.g. "+919876543210", null otherwise>,
  "khata_action": <"credit" | "payment" | "balance" | "history" | "list" | "reminder" | "download_customer" | "download_all" | null>,
  "khata_customer_name": <customer name string e.g. "Ashish", null if not a khata action>,
  "khata_customer_mobile": <mobile number string e.g. "+919876543210" if mentioned, null otherwise>,
  "khata_amount": <number if credit or payment, 0 otherwise>,
  "khata_description": <description of goods/reason e.g. "kirana saman", null otherwise>
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
- "500 ka kirana saman Ashish ko diya" → type:single, khata_action:"credit", khata_customer_name:"Ashish", khata_amount:500, khata_description:"kirana saman"
- "I gave 500 grocery to Ashish" → type:single, khata_action:"credit", khata_customer_name:"Ashish", khata_amount:500, khata_description:"grocery"
- "Bhai ko 2000 diye" → type:single, khata_action:"credit", khata_customer_name:"Bhai", khata_amount:2000, khata_description:"personal loan"
- "Rahul ko 1500 udhaar diya" → type:single, khata_action:"credit", khata_customer_name:"Rahul", khata_amount:1500, khata_description:"udhaar"
- "Sharma ji ke saath dinner mein 600 diya unka" → type:single, khata_action:"credit", khata_customer_name:"Sharma ji", khata_amount:600, khata_description:"dinner"
- "Colony trip mein 3000 advance diya Ramesh ko" → type:single, khata_action:"credit", khata_customer_name:"Ramesh", khata_amount:3000, khata_description:"trip advance"
- "Ashish ne 200 diya" → type:single, khata_action:"payment", khata_customer_name:"Ashish", khata_amount:200, khata_description:"payment received"
- "Ashish ne 200 rupaye waapis kiye" → type:single, khata_action:"payment", khata_customer_name:"Ashish", khata_amount:200
- "Bhai ne 500 waapis kiye" → type:single, khata_action:"payment", khata_customer_name:"Bhai", khata_amount:500
- "Rahul ne paise de diye 1000" → type:single, khata_action:"payment", khata_customer_name:"Rahul", khata_amount:1000
- "Ashish ka hisaab" or "Ashish ka balance" → type:single, khata_action:"balance", khata_customer_name:"Ashish"
- "Bhai ko kitna dena hai" → type:single, khata_action:"balance", khata_customer_name:"Bhai"
- "Rahul ka kitna baaki hai" → type:single, khata_action:"balance", khata_customer_name:"Rahul"
- "Ashish ki history" or "Ashish ka ledger" → type:single, khata_action:"history", khata_customer_name:"Ashish"
- "sabka hisaab" or "all customers balance" or "sabka kitna baaki hai" → type:single, khata_action:"list"
- "kisko kitna dena hai" or "pending dues" → type:single, khata_action:"list"
- "Ashish ko reminder bhejo" → type:single, khata_action:"reminder", khata_customer_name:"Ashish"
- "Bhai ko yaad dilao" → type:single, khata_action:"reminder", khata_customer_name:"Bhai"
- "sabko reminder bhejo" → type:single, khata_action:"reminder", khata_customer_name:null
- "Ashish ki history download karo" or "Ashish ka PDF" → type:single, khata_action:"download_customer", khata_customer_name:"Ashish"
- "poora khata download karo" or "full ledger PDF" or "sab ki list download" → type:single, khata_action:"download_all"
- "Ashish ka number +919876543210 hai" → type:single, khata_action:"balance", khata_customer_name:"Ashish", khata_customer_mobile:"+919876543210"
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
