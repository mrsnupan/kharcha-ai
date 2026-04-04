package com.kharchaai

import android.util.Log
import okhttp3.CertificatePinner
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * All HTTP calls to the KharchaAI backend.
 *
 * Security hardening:
 * - Certificate pinning: rejects any MITM certificate, even from a valid CA
 * - Authorization: Bearer header (token never in request body)
 * - Production-only logs (no sensitive data in logcat)
 * - TLS 1.2+ enforced via network_security_config.xml
 */
object ApiClient {

    private const val TAG = "KharchaApiClient"

    /**
     * Certificate pinning — add your server's certificate SHA-256 public key hash here.
     *
     * How to get your pin:
     *   openssl s_client -connect your-server.railway.app:443 | \
     *   openssl x509 -pubkey -noout | \
     *   openssl rsa -pubin -outform DER | \
     *   openssl dgst -sha256 -binary | base64
     *
     * Set CERTIFICATE_PIN in BuildConfig or replace the placeholder.
     * Add backup pin (second entry) to avoid lockout during cert rotation.
     */
    private val certificatePinner by lazy {
        val serverHost = BuildConfig.SERVER_URL
            .removePrefix("https://")
            .removePrefix("http://")
            .split("/")[0]

        CertificatePinner.Builder()
            .add(serverHost, "sha256/${BuildConfig.CERT_PIN_PRIMARY}")
            .add(serverHost, "sha256/${BuildConfig.CERT_PIN_BACKUP}")
            .build()
    }

    private val client by lazy {
        val builder = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)

        // Only apply certificate pinning in production builds
        if (!BuildConfig.DEBUG) {
            builder.certificatePinner(certificatePinner)
        }

        builder.build()
    }

    private val JSON = "application/json; charset=utf-8".toMediaType()
    private val BASE_URL: String get() = BuildConfig.SERVER_URL

    // ──────────────────────────────────────────────────────────
    // POST /api/register — request OTP
    // ──────────────────────────────────────────────────────────
    fun requestOtp(phone: String): Result<String> {
        return try {
            val body = JSONObject().put("phone", phone).toString().toRequestBody(JSON)
            val request = Request.Builder()
                .url("$BASE_URL/api/register")
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            val responseBody = response.body?.string() ?: ""

            // Production: never log response body (may contain sensitive data)
            if (BuildConfig.DEBUG) Log.d(TAG, "requestOtp: ${response.code}")

            if (response.isSuccessful) {
                Result.success("OTP sent")
            } else {
                val msg = runCatching { JSONObject(responseBody).getString("error") }
                    .getOrDefault("Server error ${response.code}")
                Result.failure(Exception(msg))
            }
        } catch (e: Exception) {
            if (BuildConfig.DEBUG) Log.e(TAG, "requestOtp failed", e)
            else Log.e(TAG, "requestOtp failed: ${e.javaClass.simpleName}")
            Result.failure(e)
        }
    }

    // ──────────────────────────────────────────────────────────
    // POST /api/verify — verify OTP, get Bearer token
    // ──────────────────────────────────────────────────────────
    fun verifyOtp(phone: String, otp: String): Result<Pair<String, String?>> {
        return try {
            val body = JSONObject()
                .put("phone", phone)
                .put("otp", otp)
                .toString()
                .toRequestBody(JSON)

            val request = Request.Builder()
                .url("$BASE_URL/api/verify")
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            val responseBody = response.body?.string() ?: ""

            if (BuildConfig.DEBUG) Log.d(TAG, "verifyOtp: ${response.code}")

            if (response.isSuccessful) {
                val json = JSONObject(responseBody)
                val token = json.getString("token")
                val name  = json.optString("name", null)
                // NEVER log token
                Result.success(Pair(token, name))
            } else {
                val msg = runCatching { JSONObject(responseBody).getString("error") }
                    .getOrDefault("Wrong OTP. Dobara try karo.")
                Result.failure(Exception(msg))
            }
        } catch (e: Exception) {
            if (BuildConfig.DEBUG) Log.e(TAG, "verifyOtp failed", e)
            else Log.e(TAG, "verifyOtp failed: ${e.javaClass.simpleName}")
            Result.failure(e)
        }
    }

    // ──────────────────────────────────────────────────────────
    // POST /webhook/sms — forward bank SMS
    // Token sent in Authorization: Bearer header (not body)
    // ──────────────────────────────────────────────────────────
    fun forwardSms(token: String, smsText: String, senderId: String, receivedAt: Long): Boolean {
        return try {
            val body = JSONObject()
                .put("message", smsText)
                .put("from", senderId)
                .put("received_at", receivedAt)
                .toString()
                .toRequestBody(JSON)

            val request = Request.Builder()
                .url("$BASE_URL/webhook/sms")
                .post(body)
                .addHeader("Authorization", "Bearer $token")  // token in header, not body
                .build()

            val response = client.newCall(request).execute()
            if (BuildConfig.DEBUG) Log.d(TAG, "forwardSms: ${response.code} from $senderId")
            response.isSuccessful
        } catch (e: Exception) {
            if (BuildConfig.DEBUG) Log.e(TAG, "forwardSms failed", e)
            else Log.e(TAG, "forwardSms failed: ${e.javaClass.simpleName}")
            false
        }
    }

    // ──────────────────────────────────────────────────────────
    // Health check
    // ──────────────────────────────────────────────────────────
    fun healthCheck(): Boolean {
        return try {
            val request = Request.Builder().url("$BASE_URL/health").get().build()
            client.newCall(request).execute().isSuccessful
        } catch (e: Exception) {
            false
        }
    }
}
