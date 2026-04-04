package com.kharchaai

/**
 * Filters incoming SMS — only forwards bank/UPI messages.
 * Prevents personal SMS from being sent to the server.
 *
 * Two-layer check:
 *  1. Known Indian bank/UPI sender IDs (most reliable)
 *  2. Content keywords (fallback for new/unknown sender IDs)
 */
object BankSmsFilter {

    // Known bank & UPI sender IDs used in India
    // Format: 6-char alphanumeric codes used by telecom as "VM-HDFCBK" etc.
    private val KNOWN_BANK_SENDERS = setOf(
        // SBI
        "SBIINB", "SBICRD", "SBIUPI", "SBIPSG", "SBISHB",
        // HDFC
        "HDFCBK", "HDFCBN", "HDFCCR", "HDFCSC",
        // ICICI
        "ICICIB", "ICICIC", "ICICIB", "ICICRD",
        // Axis
        "AXISBK", "AXISBN", "AXISBT",
        // Kotak
        "KOTAKB", "KOTKMB",
        // PNB
        "PNBSMS", "PNBBNK",
        // Canara
        "CANBNK", "CANBKG",
        // Yes Bank
        "YESBNK", "YESBKG",
        // BOI
        "BOIIND",
        // Union Bank
        "UNIONB", "UBIBNK",
        // Indian Bank
        "INDBNK",
        // Central Bank
        "CENTBK",
        // IDBI
        "IDBIBK",
        // Federal Bank
        "FEDBKM",
        // RBL
        "RBLBNK",
        // Standard Chartered
        "SCBKSC",
        // Citibank
        "CITIBN",
        // HSBC
        "HSBCIN",
        // IndusInd
        "INDUSB",
        // Bank of Baroda
        "BOBIBN", "BARBNK",
        // UPI / Wallet apps
        "PAYTMB", "PAYTMP", "PYTMBN",
        "PHONEPE", "PPESMS",
        "GPAYBN", "GOOGPAY",
        "AMZNPAY", "AMAZON",
        "BHIMUPI",
        "MOBIKW",
        // NPCI / UPI generic
        "NPCIUP", "UPIBNK"
    )

    // Content keywords that indicate a financial SMS
    private val FINANCIAL_KEYWORDS = listOf(
        "debited", "credited", "debit", "credit",
        "a/c", "account", "acct",
        "upi", "neft", "imps", "rtgs",
        "inr", "rs.", "rs ", "₹",
        "balance", "bal", "avl bal",
        "transaction", "txn",
        "otp",          // bank OTPs are useful to flag but not forward
        "payment", "paid",
        "withdrawn", "deposited"
    )

    // Sender IDs to always ignore (OTP-only, not financial)
    private val IGNORED_SENDERS = setOf(
        "AMAZON", "FLIPKRT", "SWIGGY", "ZOMATO",
        "OLACAB", "UBER", "RAPIDO", "IRCTCS"
    )

    /**
     * Returns true if the SMS should be forwarded to KharchaAI server.
     */
    fun shouldForward(senderId: String, smsText: String): Boolean {
        val senderUpper = senderId.uppercase().take(10)

        // Never forward from ignored senders (e-commerce noise)
        if (IGNORED_SENDERS.any { senderUpper.contains(it) }) return false

        // Known bank sender — trust it if content also looks financial
        val fromKnownBank = KNOWN_BANK_SENDERS.any { senderUpper.contains(it) }

        // Content check
        val lowerText = smsText.lowercase()
        val hasFinancialContent = FINANCIAL_KEYWORDS.any { lowerText.contains(it) }

        return fromKnownBank && hasFinancialContent
    }
}
