package com.kharchaai

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log

/**
 * BroadcastReceiver that fires whenever an SMS arrives.
 * Filters for bank SMS, then passes to SmsForwardService for
 * async HTTP upload (never do network in a BroadcastReceiver).
 */
class SmsReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "SmsReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        // App must be registered before we forward anything
        if (!PrefsManager.isRegistered(context)) {
            Log.d(TAG, "App not registered yet, skipping SMS")
            return
        }

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isNullOrEmpty()) return

        // Group multi-part SMS by sender
        val smsByOriginator = mutableMapOf<String, StringBuilder>()
        for (sms in messages) {
            val sender = sms.originatingAddress ?: continue
            smsByOriginator.getOrPut(sender) { StringBuilder() }
                .append(sms.messageBody)
        }

        for ((senderId, bodyBuilder) in smsByOriginator) {
            val body = bodyBuilder.toString()
            Log.d(TAG, "SMS from $senderId: ${body.take(60)}...")

            if (BankSmsFilter.shouldForward(senderId, body)) {
                Log.d(TAG, "Bank SMS detected — forwarding")
                SmsForwardService.forwardSms(
                    context   = context,
                    smsText   = body,
                    senderId  = senderId,
                    receivedAt = System.currentTimeMillis()
                )
            } else {
                Log.d(TAG, "Not a bank SMS — ignored")
            }
        }
    }
}
