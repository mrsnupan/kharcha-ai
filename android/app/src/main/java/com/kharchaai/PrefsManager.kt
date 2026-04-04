package com.kharchaai

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Secure key-value store using EncryptedSharedPreferences.
 *
 * Data is encrypted with AES-256-GCM using a key stored in
 * the Android Keystore (hardware-backed on most modern phones).
 * Even rooted phones cannot read the plaintext values.
 */
object PrefsManager {

    private const val PREFS_NAME    = "kharcha_secure_prefs"
    private const val KEY_TOKEN     = "auth_token"
    private const val KEY_PHONE     = "phone_number"
    private const val KEY_REGISTERED = "is_registered"
    private const val KEY_USER_NAME = "user_name"

    private fun prefs(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        return EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun saveToken(context: Context, token: String) =
        prefs(context).edit().putString(KEY_TOKEN, token).apply()

    fun getToken(context: Context): String? =
        prefs(context).getString(KEY_TOKEN, null)

    fun savePhone(context: Context, phone: String) =
        prefs(context).edit().putString(KEY_PHONE, phone).apply()

    fun getPhone(context: Context): String? =
        prefs(context).getString(KEY_PHONE, null)

    fun setRegistered(context: Context, value: Boolean) =
        prefs(context).edit().putBoolean(KEY_REGISTERED, value).apply()

    fun isRegistered(context: Context): Boolean =
        prefs(context).getBoolean(KEY_REGISTERED, false)

    fun saveName(context: Context, name: String) =
        prefs(context).edit().putString(KEY_USER_NAME, name).apply()

    fun getName(context: Context): String? =
        prefs(context).getString(KEY_USER_NAME, null)

    fun clear(context: Context) =
        prefs(context).edit().clear().apply()
}
