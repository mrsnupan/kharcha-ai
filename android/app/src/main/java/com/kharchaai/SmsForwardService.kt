package com.kharchaai

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Foreground service that keeps the SMS listener alive.
 * Android kills background processes aggressively on Indian phone brands
 * (Xiaomi, Realme, Samsung, OnePlus). A foreground service with a
 * persistent notification is the only reliable way to stay alive.
 *
 * The notification is minimal — users barely notice it.
 */
class SmsForwardService : Service() {

    private val job = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + job)

    companion object {
        const val TAG = "SmsForwardService"
        const val CHANNEL_ID = "kharcha_service"
        const val NOTIF_ID = 1001

        const val ACTION_FORWARD_SMS = "com.kharchaai.FORWARD_SMS"
        const val EXTRA_SMS_TEXT = "sms_text"
        const val EXTRA_SENDER_ID = "sender_id"
        const val EXTRA_RECEIVED_AT = "received_at"

        fun start(context: Context) {
            val intent = Intent(context, SmsForwardService::class.java)
            context.startForegroundService(intent)
        }

        fun forwardSms(context: Context, smsText: String, senderId: String, receivedAt: Long) {
            val intent = Intent(context, SmsForwardService::class.java).apply {
                action = ACTION_FORWARD_SMS
                putExtra(EXTRA_SMS_TEXT, smsText)
                putExtra(EXTRA_SENDER_ID, senderId)
                putExtra(EXTRA_RECEIVED_AT, receivedAt)
            }
            context.startForegroundService(intent)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification("Expense tracking active ✅"))
        Log.d(TAG, "Service started")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_FORWARD_SMS -> {
                val smsText   = intent.getStringExtra(EXTRA_SMS_TEXT) ?: return START_STICKY
                val senderId  = intent.getStringExtra(EXTRA_SENDER_ID) ?: ""
                val receivedAt = intent.getLongExtra(EXTRA_RECEIVED_AT, System.currentTimeMillis())

                scope.launch {
                    handleSms(smsText, senderId, receivedAt)
                }
            }
        }
        // START_STICKY: Android will restart this service if killed
        return START_STICKY
    }

    private suspend fun handleSms(smsText: String, senderId: String, receivedAt: Long) {
        val token = PrefsManager.getToken(this)
        if (token.isNullOrBlank()) {
            Log.w(TAG, "No token found — app not registered yet")
            return
        }

        Log.d(TAG, "Forwarding SMS from $senderId")
        val success = ApiClient.forwardSms(token, smsText, senderId, receivedAt)

        if (success) {
            Log.d(TAG, "SMS forwarded successfully")
            updateNotification("Last SMS: ${java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(java.util.Date())}")
        } else {
            Log.w(TAG, "SMS forward failed — will retry is not implemented in v1")
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        job.cancel()
        Log.d(TAG, "Service destroyed")
    }

    // ── Notification helpers ──

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "KharchaAI",
            NotificationManager.IMPORTANCE_LOW  // LOW = no sound, minimal UI
        ).apply {
            description = "Expense tracking service"
            setShowBadge(false)
        }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("KharchaAI")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_manage)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIF_ID, buildNotification(text))
    }
}
