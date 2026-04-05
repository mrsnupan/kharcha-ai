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
  "income_log": <boolean, true if user is logging income they received>,
  "income_amount": <number if logging income, 0 otherwise>,
  "income_category": <one of: salary, freelance, business, rent, investment, transfer, refund, other — null if not income>,
  "income_description": <description e.g. "April salary", "Freelance project", null otherwise>,
  "income_query": <boolean, true if asking about income or savings>,
  "report_schedule_set": <boolean, true if user is setting weekly report day/time>,
  "report_day": <day name string e.g. "monday", "sunday", "somvar" — null if not setting>,
  "report_hour": <number 0-23 e.g. 8 for 8am, 20 for 8pm — null if not setting>,
  "report_disable": <boolean, true if user wants to disable weekly report>,
  "khata_action": <"credit" | "payment" | "balance" | "history" | "list" | "reminder" | "download_customer" | "download_all" | null>,
  "khata_customer_name": <customer name string e.g. "Ashish", null if not a khata action>,
  "khata_customer_mobile": <mobile number string e.g. "+919876543210" if mentioned, null otherwise>,
  "khata_amount": <number if credit or payment, 0 otherwise>,
  "khata_description": <description of goods/reason e.g. "kirana saman", null otherwise>,
  "emi_action": <"add" | "list" | "done" | null>,
  "emi_name": <EMI name string e.g. "Home Loan EMI", "Car Loan EMI", null otherwise>,
  "emi_amount": <number if adding EMI, 0 otherwise>,
  "emi_due_day": <day of month 1-31 e.g. 5 for "5th of every month", null if not adding>,
  "savings_action": <"add_goal" | "add_money" | "list" | "check" | null>,
  "savings_goal_name": <goal name string e.g. "Goa Trip", "New Phone", null otherwise>,
  "savings_target_amount": <target amount if creating new goal, 0 otherwise>,
  "savings_add_amount": <amount being added to goal if savings_action="add_money", 0 otherwise>,
  "savings_deadline": <deadline string e.g. "31-12-2026", "3 mahine mein", null otherwise>,
  "split_total": <total amount to split e.g. 1200, 0 if not a split>,
  "split_count": <number of people to split between e.g. 4, 0 if not a split>,
  "split_description": <what it's for e.g. "dinner", "movie", null otherwise>,
  "tax_action": <"log_deduction" | "deduction_summary" | "tax_estimate" | "tax_nudge" | "set_regime" | "set_income_type" | "export_pdf" | "advance_tax" | null>,
  "tax_section": <"80C" | "80D_self" | "80D_parents" | "80E" | "24b" | "80CCD" | "80G" | "80TTA" | null>,
  "tax_sub_category": <"ppf" | "elss" | "lic" | "epf" | "home_loan_principal" | "tuition_fees" | "nsc" | "tax_saver_fd" | "nps_80c" | "health_self" | "health_parents" | "education_loan" | "home_loan_interest" | "nps_additional" | null>,
  "tax_amount": <number if logging a deduction, 0 otherwise>,
  "tax_description": <description e.g. "LIC premium", "PPF deposit", null otherwise>,
  "tax_regime": <"old" | "new" | null>,
  "tax_income_type": <"salaried" | "freelance" | "business" | null>,
  "gst_action": <"log_expense" | "summary" | null>,
  "gst_base_amount": <base amount before GST, 0 if not a GST action>,
  "gst_rate": <5 | 12 | 18 | 28 | null>,
  "gst_description": <description e.g. "office furniture", null otherwise>,
  "gst_vendor_gstin": <GSTIN string if mentioned, null otherwise>,
  "expense_delete": <boolean, true if user wants to delete/undo an expense entry>,
  "delete_last": <boolean, true if user says "last entry", "last wali", "abhi jo daala">,
  "delete_amount": <number if user mentions a specific amount to delete, 0 otherwise>,
  "user_name": <string if user is introducing themselves e.g. "mera naam Rahul hai" → "Rahul", null otherwise>
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
- "weekly report Monday 8 am set karo" → type:single, report_schedule_set:true, report_day:"monday", report_hour:8
- "mujhe Sunday 9 baje weekly report chahiye" → type:single, report_schedule_set:true, report_day:"sunday", report_hour:9
- "weekly report band karo" → type:single, report_disable:true
- "weekly reminder Tuesday evening 6 baje" → type:single, report_schedule_set:true, report_day:"tuesday", report_hour:18
- "aaj salary aayi 45000" → type:single, income_log:true, income_amount:45000, income_category:"salary", income_description:"April salary"
- "freelance ka payment mila 8000" → type:single, income_log:true, income_amount:8000, income_category:"freelance", income_description:"Freelance payment"
- "rent mila 15000" → type:single, income_log:true, income_amount:15000, income_category:"rent", income_description:"Rent received"
- "Papa ne 5000 transfer kiye" → type:single, income_log:true, income_amount:5000, income_category:"transfer", income_description:"Transfer from Papa"
- "is mahine ki income kitni hai" → type:single, income_query:true, query_type:"monthly"
- "income vs expense dikhao" or "savings kitna hua" → type:single, income_query:true, query_type:"monthly"
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
- "Home Loan EMI 12000 date 5" → type:single, emi_action:"add", emi_name:"Home Loan EMI", emi_amount:12000, emi_due_day:5
- "Car loan ki EMI 8500 har 15 tarikh ko" → type:single, emi_action:"add", emi_name:"Car Loan EMI", emi_amount:8500, emi_due_day:15
- "personal loan 5000 ki EMI 10th ko" → type:single, emi_action:"add", emi_name:"Personal Loan EMI", emi_amount:5000, emi_due_day:10
- "meri EMI list dikhao" → type:single, emi_action:"list"
- "Home Loan EMI pay ho gayi" → type:single, emi_action:"done", emi_name:"Home Loan EMI"
- "Goa trip ke liye 20000 bachana hai" → type:single, savings_action:"add_goal", savings_goal_name:"Goa Trip", savings_target_amount:20000
- "naya phone ke liye 15000 save karna hai 3 mahine mein" → type:single, savings_action:"add_goal", savings_goal_name:"New Phone", savings_target_amount:15000, savings_deadline:"3 mahine mein"
- "Wedding fund 50000 December tak" → type:single, savings_action:"add_goal", savings_goal_name:"Wedding Fund", savings_target_amount:50000, savings_deadline:"December"
- "Goal mein 5000 daalo" or "savings mein 5000" → type:single, savings_action:"add_money", savings_add_amount:5000
- "Goa trip goal mein 2000 daalo" → type:single, savings_action:"add_money", savings_goal_name:"Goa Trip", savings_add_amount:2000
- "meri goals dikhao" or "savings goals kya hain" → type:single, savings_action:"list"
- "Goa trip kitna hua?" → type:single, savings_action:"check", savings_goal_name:"Goa Trip"
- "dinner 1200, hum 4 the" → type:single, split_total:1200, split_count:4, split_description:"dinner"
- "movie 600, 3 log" → type:single, split_total:600, split_count:3, split_description:"movie ticket"
- "1500 ki party, hum 5 dost the" → type:single, split_total:1500, split_count:5, split_description:"party"
- "petrol 500 split karo 2 mein" → type:single, split_total:500, split_count:2, split_description:"petrol"
- "mera naam Rahul hai" → user_name:"Rahul"
- "I am Priya" or "main Priya hoon" → user_name:"Priya"
- "last entry delete karo" → expense_delete:true, delete_last:true
- "last wali entry galat thi" → expense_delete:true, delete_last:true
- "abhi jo daala woh hata do" → expense_delete:true, delete_last:true
- "500 wali entry delete karo" → expense_delete:true, delete_amount:500
- "chai 30 galat tha, delete karo" → expense_delete:true, delete_amount:30
- "undo" or "undo karo" → expense_delete:true, delete_last:true
- "LIC ka premium 15000 bhara" → tax_action:"log_deduction", tax_section:"80C", tax_sub_category:"lic", tax_amount:15000, tax_description:"LIC Premium"
- "PPF mein 50000 daala" → tax_action:"log_deduction", tax_section:"80C", tax_sub_category:"ppf", tax_amount:50000, tax_description:"PPF Deposit"
- "ELSS mein 25000 invest kiya" → tax_action:"log_deduction", tax_section:"80C", tax_sub_category:"elss", tax_amount:25000, tax_description:"ELSS Investment"
- "health insurance ka premium 12000" → tax_action:"log_deduction", tax_section:"80D_self", tax_sub_category:"health_self", tax_amount:12000, tax_description:"Health Insurance"
- "parents ki health insurance 20000" → tax_action:"log_deduction", tax_section:"80D_parents", tax_sub_category:"health_parents", tax_amount:20000
- "home loan interest 1.5 lakh diya" → tax_action:"log_deduction", tax_section:"24b", tax_amount:150000, tax_description:"Home Loan Interest"
- "education loan ka interest 45000" → tax_action:"log_deduction", tax_section:"80E", tax_sub_category:"education_loan", tax_amount:45000
- "NPS mein 50000 alag se daala" → tax_action:"log_deduction", tax_section:"80CCD", tax_sub_category:"nps_additional", tax_amount:50000
- "80C mein kitna hua?" or "meri deductions dikhao" → tax_action:"deduction_summary"
- "tax kitna banega?" or "income tax estimate karo" → tax_action:"tax_estimate"
- "tax bachaane ke tips" or "tax saving suggestions" → tax_action:"tax_nudge"
- "old regime choose karna hai" → tax_action:"set_regime", tax_regime:"old"
- "new regime mein rehna hai" → tax_action:"set_regime", tax_regime:"new"
- "main freelancer hoon" → tax_action:"set_income_type", tax_income_type:"freelance"
- "main salaried hoon" → tax_action:"set_income_type", tax_income_type:"salaried"
- "tax summary PDF download karo" → tax_action:"export_pdf"
- "advance tax kitna bharna hai?" → tax_action:"advance_tax"
- "old vs new regime compare karo" → tax_action:"tax_estimate"
- "18% GST ke saath 5000 ka saman liya" → gst_action:"log_expense", gst_base_amount:5000, gst_rate:18, gst_description:"purchase"
- "office laptop 80000 + 18 percent GST" → gst_action:"log_expense", gst_base_amount:80000, gst_rate:18, gst_description:"office laptop"
- "is mahine ka GST dikhao" or "GST input summary" → gst_action:"summary"
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
