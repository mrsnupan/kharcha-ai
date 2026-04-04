# KharchaAI 🇮🇳💰

> WhatsApp-based expense tracker for Indian households.
> Track expenses via SMS forwarding, chat (Hindi/English/Hinglish), and voice messages. No app needed.

---

## Features

| Feature | Description |
|---|---|
| 📱 SMS Auto-Tracking | Automatically logs bank/UPI SMS via SMS Forwarder app |
| 💬 Chat Input | Natural Hinglish — "chai 30", "petrol 500", "bai salary 3000" |
| 🎤 Voice Messages | WhatsApp voice note → Whisper transcription → logged |
| 📊 Reports | Daily / weekly / monthly summaries with category breakdown |
| 🎯 Budgets | Per-category budgets with 80%/100% alerts |
| 👨‍👩‍👧 Family | Multiple family members sharing one expense pool |

---

## Tech Stack

- **Backend** — Node.js + Express
- **Database** — PostgreSQL via [Supabase](https://supabase.com)
- **WhatsApp** — Twilio WhatsApp Business API
- **Voice** — OpenAI Whisper API
- **AI** — Anthropic Claude API (claude-sonnet-4-6)
- **SMS Forwarder** — [SMS Forwarder](https://play.google.com/store/apps/details?id=com.frzinapps.smsforward) Android app
- **Hosting** — Railway.app

---

## Quick Start

### 1. Clone & Install

```bash
git clone <your-repo>
cd kharcha-ai
npm install
```

### 2. Environment Variables

```bash
cp .env.example .env
# Edit .env and fill in all values
```

| Variable | Where to get it |
|---|---|
| `TWILIO_ACCOUNT_SID` | [console.twilio.com](https://console.twilio.com) |
| `TWILIO_AUTH_TOKEN` | [console.twilio.com](https://console.twilio.com) |
| `TWILIO_WHATSAPP_NUMBER` | Twilio WhatsApp sandbox number |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `SUPABASE_URL` | Supabase project Settings → API |
| `SUPABASE_KEY` | Supabase project Settings → API (anon/public key) |

### 3. Database Setup

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Open **SQL Editor**
3. Paste the contents of `database/schema.sql`
4. Click **Run**

### 4. Run Locally

```bash
npm run dev
# Server starts on port 3000
```

### 5. Expose locally with ngrok (for Twilio webhooks)

```bash
ngrok http 3000
# Copy the https URL e.g. https://abc123.ngrok.io
```

---

## Twilio WhatsApp Sandbox Setup

1. Go to [Twilio Console → Messaging → Try WhatsApp](https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn)
2. Connect your WhatsApp number by sending the sandbox join code (e.g. `join <word>-<word>`) to the sandbox number
3. Set the **"When a message comes in"** webhook to:
   ```
   https://your-ngrok-or-railway-url.app/webhook/whatsapp
   ```
   Method: **HTTP POST**
4. Save configuration

> For production: Apply for a WhatsApp Business Account in Twilio and use a real number.

---

## SMS Forwarder Android App Setup

1. Install [SMS Forwarder](https://play.google.com/store/apps/details?id=com.frzinapps.smsforward) from Play Store
2. Open the app → **Add Rule**
3. Configure:
   | Field | Value |
   |---|---|
   | **Rule type** | Webhook |
   | **Filter** | All SMS (or add bank sender IDs like `HDFCBK`, `SBIINB`, `ICICIB`) |
   | **URL** | `https://your-app-url/webhook/sms` |
   | **Method** | POST |
   | **Content-Type** | application/json |
   | **Body template** | See below |

4. Body template to use:
   ```json
   {
     "from": "%from%",
     "message": "%body%",
     "device": "+91XXXXXXXXXX",
     "secret": "your_secret_token_here"
   }
   ```
   Replace `+91XXXXXXXXXX` with the WhatsApp number of the phone running SMS Forwarder.
   Replace `your_secret_token_here` with the value in your `.env`.

5. Test by sending a bank SMS to yourself — you should get a WhatsApp confirmation.

---

## Deploy to Railway

1. Push your code to GitHub
2. Create new project on [Railway](https://railway.app) → **Deploy from GitHub**
3. Add all environment variables in Railway dashboard → Variables
4. Railway auto-deploys on push
5. Copy the Railway domain (e.g. `kharcha-ai.up.railway.app`) and update Twilio webhook URL

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/webhook/whatsapp` | POST | Twilio WhatsApp incoming messages |
| `/webhook/sms` | POST | SMS Forwarder forwarded messages |
| `/health` | GET | Health check |

---

## Folder Structure

```
kharcha-ai/
├── src/
│   ├── webhooks/
│   │   ├── whatsapp.js    # Twilio WhatsApp handler (text + voice)
│   │   └── sms.js         # SMS Forwarder webhook
│   ├── services/
│   │   ├── claude.js      # Anthropic Claude — understands Hinglish
│   │   ├── whisper.js     # OpenAI Whisper — voice transcription
│   │   ├── parser.js      # Regex SMS parser for Indian banks
│   │   ├── expenses.js    # Expense logic, queries, budget alerts
│   │   └── whatsapp.js    # Twilio send-message wrapper
│   ├── models/
│   │   ├── db.js          # Supabase client
│   │   ├── user.js        # User & family CRUD
│   │   ├── expense.js     # Expense queries
│   │   └── budget.js      # Budget CRUD
│   ├── utils/
│   │   ├── categories.js  # 14 expense categories with keywords
│   │   └── formatter.js   # WhatsApp message formatters
│   └── app.js             # Express app entry point
├── database/
│   └── schema.sql         # Full PostgreSQL schema
├── tests/
│   └── test.js            # Offline unit tests (20 test cases)
├── .env.example
├── package.json
└── README.md
```

---

## 20 Test Cases

Run offline tests (no API keys needed):
```bash
node tests/test.js
```

### Manual test cases to verify end-to-end

| # | Input | Expected Response |
|---|---|---|
| 1 | `chai 30` | ✅ ₹30 logged — Chai (Food & Dining 🍱) |
| 2 | `petrol 500` | ✅ ₹500 logged — Petrol (Transport 🚌) |
| 3 | `sabzi mein 300 diye` | ✅ ₹300 logged — Sabzi (Grocery & Vegetables 🛒) |
| 4 | `dinner at hotel 1200` | ✅ ₹1,200 logged — Dinner (Food & Dining 🍱) |
| 5 | `electricity bill 2400 bhara` | ✅ ₹2,400 logged — Electricity Bill (Utilities ⚡) |
| 6 | `school fees 15000` | ✅ ₹15,000 logged — School Fees (Education 🏫) |
| 7 | `medicine liya 450 ka` | ✅ ₹450 logged — Medicine (Healthcare & Medicine 💊) |
| 8 | `auto mein 80 diye` | ✅ ₹80 logged — Auto (Transport 🚌) |
| 9 | `zomato se khana 650` | ✅ ₹650 logged — Zomato (Food & Dining 🍱) |
| 10 | `EMI gaya 25000` | ✅ ₹25,000 logged — EMI (EMI & Loans 💰) |
| 11 | `bai ko salary di 3000` | ✅ ₹3,000 logged — Maid Salary (Household 🏠) |
| 12 | `recharge kiya 299` | ✅ ₹299 logged — Recharge (Mobile & Internet 📱) |
| 13 | `aaj kitna gaya?` | 📊 Today's expense summary |
| 14 | `is hafte kitna gaya?` | 📊 This week's summary |
| 15 | `monthly report` | 📊 This month's summary with categories |
| 16 | `grocery pe kitna gaya?` | 📊 Grocery expenses this month |
| 17 | `last month vs this month` | 📊 Comparison report |
| 18 | `grocery budget 8000 rakho` | ✅ 🛒 Grocery & Vegetables budget set: ₹8,000/month |
| 19 | `total budget 40000` | ✅ 💰 Total budget set: ₹40,000/month |
| 20 | SMS: `Your A/c XX1234 debited INR 450.00 on 29-03-26. Info: UPI/Zomato` | ✅ ₹450 logged — Zomato (Food & Dining 🍱) |

### SMS format test cases

| Bank | Sample SMS |
|---|---|
| SBI UPI | `Your A/c XX1234 debited INR 450.00 on 29-03-26. Info: UPI/Zomato. Avl Bal: INR 45,230.00` |
| HDFC Bill | `HDFC Bank: Rs.2400 debited from a/c XX9012 towards BESCOM on 29-03-26. Available balance Rs.38,450` |
| UPI Transfer | `Dear UPI user, Rs.300.00 debited from a/c XX5678 on 29-03-26 trf to VEGETABLE MARKET Ref No 123456` |
| Credit Card | `ICICI Bank Credit Card XX4567: Rs.1,850.00 spent at AMAZON on 29-03-26` |
| Kotak | `Kotak Bank: INR 599.00 debited from A/c XX3456 for Netflix subscription on 29-03-26` |

---

## Sample Conversations

### Hinglish expense logging
```
You:  chai 30
Bot:  ✅ ₹30 logged — Chai (Food & Dining 🍱)

You:  aaj kitna gaya?
Bot:  📊 Aaj ka Summary
      🍱 Food & Dining: ₹30 (1 transaction)
      💰 Total: ₹30

You:  grocery budget 8000 rakho
Bot:  ✅ 🛒 Grocery & Vegetables budget set: ₹8,000/month
```

### Budget alert (auto-sent)
```
Bot:  ⚠️ 🛒 Grocery & Vegetables budget 80% used!
      ₹6,400 of ₹8,000 spent.
      ₹1,600 remaining
```

### SMS auto-log
```
[Bank SMS received via SMS Forwarder]
Bot:  ✅ ₹450 logged — Zomato (Food & Dining 🍱)
```

---

## Supported Banks / Apps

SBI · HDFC · ICICI · Axis · Kotak · PNB · Canara · Yes Bank
GPay · PhonePe · Paytm · Amazon Pay · BHIM UPI
Zomato · Swiggy · Amazon · Flipkart (debit confirmations)

---

## License

MIT
