package com.kharchaai

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Restarts SmsForwardService after device reboot.
 * Without this, the service won't survive a phone restart.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON") return

        if (!PrefsManager.isRegistered(context)) {
            Log.d("BootReceiver", "App not registered — skipping service start")
            return
        }

        Log.d("BootReceiver", "Boot complete — starting SmsForwardService")
        SmsForwardService.start(context)
    }
}
