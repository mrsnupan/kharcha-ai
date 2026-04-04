package com.kharchaai

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.kharchaai.databinding.ActivityMainBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private val SMS_PERMISSIONS = arrayOf(
        Manifest.permission.RECEIVE_SMS,
        Manifest.permission.READ_SMS
    )
    private val PERMISSION_REQUEST_CODE = 100
    private val NOTIF_PERMISSION_CODE = 101

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // If already registered, jump straight to active screen
        if (PrefsManager.isRegistered(this)) {
            showActiveScreen()
            ensureServiceRunning()
            checkSmsPermission()
            return
        }

        setupStep1()
    }

    // ──────────────────────────────────────────────────────────
    // Step 1 — Phone number input
    // ──────────────────────────────────────────────────────────
    private fun setupStep1() {
        showCard(CardState.SETUP)
        binding.layoutPhone.visibility = View.VISIBLE
        binding.layoutOtp.visibility   = View.GONE
        binding.tvStepLabel.text = "Step 1 of 2 — Apna WhatsApp number daalo"

        binding.btnSendOtp.setOnClickListener {
            val raw = binding.etPhone.text?.toString()?.trim() ?: ""
            val phone = normalizePhone(raw)

            if (phone == null) {
                showError("Valid Indian mobile number daalo (10 digits)")
                return@setOnClickListener
            }

            PrefsManager.savePhone(this, phone)
            sendOtp(phone)
        }
    }

    private fun sendOtp(phone: String) {
        showLoading(true)
        clearError()

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) { ApiClient.requestOtp(phone) }

            showLoading(false)

            result.fold(
                onSuccess = {
                    Toast.makeText(this@MainActivity, "OTP aapke WhatsApp pe bheja gaya ✅", Toast.LENGTH_LONG).show()
                    showStep2(phone)
                },
                onFailure = { e ->
                    showError(e.message ?: "OTP send karne mein dikkat aayi. Retry karo.")
                }
            )
        }
    }

    // ──────────────────────────────────────────────────────────
    // Step 2 — OTP verification
    // ──────────────────────────────────────────────────────────
    private fun showStep2(phone: String) {
        binding.layoutPhone.visibility = View.GONE
        binding.layoutOtp.visibility   = View.VISIBLE
        binding.tvStepLabel.text = "Step 2 of 2 — OTP enter karo"
        binding.tvOtpSentTo.text = "OTP aapke WhatsApp pe bheja gaya:\n$phone"

        binding.btnVerifyOtp.setOnClickListener {
            val otp = binding.etOtp.text?.toString()?.trim() ?: ""
            if (otp.length != 6) {
                showError("6-digit OTP daalo")
                return@setOnClickListener
            }
            verifyOtp(phone, otp)
        }

        binding.tvResendOtp.setOnClickListener {
            binding.etOtp.text?.clear()
            clearError()
            sendOtp(phone)
        }
    }

    private fun verifyOtp(phone: String, otp: String) {
        showLoading(true)
        clearError()

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) { ApiClient.verifyOtp(phone, otp) }

            showLoading(false)

            result.fold(
                onSuccess = { (token, name) ->
                    PrefsManager.saveToken(this@MainActivity, token)
                    PrefsManager.setRegistered(this@MainActivity, true)
                    if (name != null) PrefsManager.saveName(this@MainActivity, name)

                    // Request SMS permission then show active screen
                    requestSmsPermission()
                },
                onFailure = { e ->
                    showError(e.message ?: "OTP galat hai. Dobara try karo.")
                }
            )
        }
    }

    // ──────────────────────────────────────────────────────────
    // Active screen (post-registration)
    // ──────────────────────────────────────────────────────────
    private fun showActiveScreen() {
        showCard(CardState.ACTIVE)

        val phone = PrefsManager.getPhone(this) ?: ""
        val name  = PrefsManager.getName(this)
        binding.tvActiveTitle.text = if (name != null) "Namaste, $name! ✅" else "KharchaAI Active hai! ✅"
        binding.tvActivePhone.text = phone

        binding.btnOpenWhatsApp.setOnClickListener {
            openWhatsApp()
        }

        binding.btnLogout.setOnClickListener {
            confirmLogout()
        }
    }

    private fun openWhatsApp() {
        // Opens WhatsApp — user can message the KharchaAI bot number
        try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("https://wa.me/")
                setPackage("com.whatsapp")
            }
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(this, "WhatsApp install karo pehle", Toast.LENGTH_SHORT).show()
        }
    }

    private fun confirmLogout() {
        AlertDialog.Builder(this)
            .setTitle("Logout karna chahte ho?")
            .setMessage("Logout karne ke baad bank SMS track hona band ho jayega.")
            .setPositiveButton("Haan, Logout") { _, _ ->
                PrefsManager.clear(this)
                stopService(Intent(this, SmsForwardService::class.java))
                recreate()
            }
            .setNegativeButton("Nahi", null)
            .show()
    }

    // ──────────────────────────────────────────────────────────
    // SMS Permission handling
    // ──────────────────────────────────────────────────────────
    private fun requestSmsPermission() {
        // Also request notification permission on Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIF_PERMISSION_CODE
                )
            }
        }

        if (hasSmsPermission()) {
            onPermissionGranted()
            return
        }

        // Show rationale first — explain WHY we need this in simple Hindi
        AlertDialog.Builder(this)
            .setTitle("SMS Permission Chahiye")
            .setMessage(
                "Bank aur UPI messages automatic track karne ke liye KharchaAI ko " +
                "SMS padhne ki permission chahiye.\n\n" +
                "Sirf bank ke messages forward honge — baaki koi bhi SMS nahi."
            )
            .setPositiveButton("Permission Do") { _, _ ->
                ActivityCompat.requestPermissions(this, SMS_PERMISSIONS, PERMISSION_REQUEST_CODE)
            }
            .setNegativeButton("Baad mein") { _, _ ->
                // User can grant later from active screen
                showActiveScreen()
                binding.cardPermission.visibility = View.VISIBLE
            }
            .setCancelable(false)
            .show()
    }

    private fun checkSmsPermission() {
        if (!hasSmsPermission()) {
            binding.cardPermission.visibility = View.VISIBLE
            binding.btnGrantPermission.setOnClickListener {
                ActivityCompat.requestPermissions(this, SMS_PERMISSIONS, PERMISSION_REQUEST_CODE)
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        when (requestCode) {
            PERMISSION_REQUEST_CODE -> {
                if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
                    onPermissionGranted()
                } else {
                    showActiveScreen()
                    binding.cardPermission.visibility = View.VISIBLE
                    Toast.makeText(this, "SMS permission ke bina bank SMS track nahi hoga", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun onPermissionGranted() {
        binding.cardPermission.visibility = View.GONE
        ensureServiceRunning()
        showActiveScreen()
        Toast.makeText(this, "Sab set hai! Ab WhatsApp pe KharchaAI se baat karo 🎉", Toast.LENGTH_LONG).show()
    }

    private fun hasSmsPermission(): Boolean =
        SMS_PERMISSIONS.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }

    // ──────────────────────────────────────────────────────────
    // Service
    // ──────────────────────────────────────────────────────────
    private fun ensureServiceRunning() {
        SmsForwardService.start(this)
    }

    // ──────────────────────────────────────────────────────────
    // UI helpers
    // ──────────────────────────────────────────────────────────
    private enum class CardState { SETUP, ACTIVE }

    private fun showCard(state: CardState) {
        binding.cardSetup.visibility   = if (state == CardState.SETUP)   View.VISIBLE else View.GONE
        binding.cardActive.visibility  = if (state == CardState.ACTIVE)  View.VISIBLE else View.GONE
    }

    private fun showLoading(show: Boolean) {
        binding.progressBar.visibility = if (show) View.VISIBLE else View.GONE
        binding.btnSendOtp.isEnabled   = !show
        binding.btnVerifyOtp.isEnabled = !show
    }

    private fun showError(msg: String) {
        binding.tvError.text       = msg
        binding.tvError.visibility = View.VISIBLE
    }

    private fun clearError() {
        binding.tvError.text       = ""
        binding.tvError.visibility = View.GONE
    }

    // ──────────────────────────────────────────────────────────
    // Phone number normalization
    // Accepts: 9876543210 / 09876543210 / +919876543210
    // Returns: +919876543210 or null if invalid
    // ──────────────────────────────────────────────────────────
    private fun normalizePhone(input: String): String? {
        val digits = input.filter { it.isDigit() }
        return when {
            digits.length == 10 && digits[0] in '6'..'9' -> "+91$digits"
            digits.length == 12 && digits.startsWith("91") -> "+$digits"
            digits.length == 11 && digits.startsWith("0") -> "+91${digits.drop(1)}"
            input.startsWith("+91") && digits.length == 12 -> "+$digits"
            else -> null
        }
    }
}
