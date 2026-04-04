# KharchaAI — Security & Compliance Guide

## India-Specific Regulations

### 1. DPDP Act 2023 (Digital Personal Data Protection)
India's primary data protection law. **Mandatory compliance before launch.**

| Requirement | How KharchaAI handles it |
|---|---|
| **Consent before data collection** | `/user/consent` endpoint + consent_log table |
| **Right to Access** | `GET /user/data` — exports all personal data as JSON |
| **Right to Erasure** | `POST /user/delete` — schedules deletion within 30 days |
| **Purpose Limitation** | Data used only for expense tracking; stated at registration |
| **Data Minimization** | Raw bank SMS not stored; only extracted fields (amount, merchant, date) |
| **Breach Notification** | Notify CERT-In within **72 hours** + affected users within **72 hours** |
| **Data Localization** | Host on servers in India (use Railway India region or AWS ap-south-1) |

**Action items:**
- [ ] Add Privacy Policy link in app (required)
- [ ] Add Terms of Service link in app (required)
- [ ] Display explicit consent dialog before first SMS permission
- [ ] Register as "Data Fiduciary" with DPB (Data Protection Board) when required

---

### 2. RBI Data Localization (2018 Circular)
Payment and transaction data involving Indian users **must be stored in India.**

> "All payment system operators shall ensure that data related to payment systems operated by them are stored in a system only in India." — RBI Circular April 2018

**What this means for KharchaAI:**
- Supabase must use `ap-south-1` (Mumbai) region
- Railway must use India region (or fallback: AWS Mumbai)
- No payment data transmitted to US/EU servers without a copy in India

**Action items:**
- [ ] In Supabase: Settings → Infrastructure → Region → `ap-south-1`
- [ ] In Railway: Select India region when available, otherwise use Railway + Supabase Mumbai

---

### 3. CERT-In Guidelines (April 2022)
Indian Computer Emergency Response Team mandates for all service providers:

| Requirement | Implementation |
|---|---|
| **Incident reporting** | Report cyber incidents to CERT-In within **6 hours** |
| **Log retention** | Retain all logs for **180 days** in India |
| **NTP sync** | Sync servers to Indian NTP servers (`time.ndma.gov.in`) |
| **KYC for subscribers** | WhatsApp number = phone-verified (OTP) — satisfies basic KYC |

**Log retention setup in Supabase:**
```sql
-- Auto-delete audit logs older than 180 days (run as weekly cron)
DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '180 days';
-- Note: CERT-In requires KEEPING logs 180 days, not deleting before that.
-- Set up a retention policy to DELETE after 180 days, not before.
```

---

### 4. IT Act 2000 + IT (Amendment) Act 2008
- **Section 43A**: Protect "sensitive personal data" — bank/financial data qualifies
- **Section 72A**: Unauthorized disclosure of personal info = up to 3 years imprisonment
- Financial data (account numbers, transaction amounts) = Sensitive Personal Data under IT Rules 2011

---

## Security Architecture Summary

### What was fixed (19 critical issues resolved)

#### Backend
| Fix | Before | After |
|---|---|---|
| Twilio webhook auth | None — anyone could forge messages | `X-Twilio-Signature` HMAC validation |
| OTP storage | In-memory Map (lost on restart) | PostgreSQL with SHA-256 hash + expiry |
| OTP in logs | `console.log(otp)` — plaintext | NEVER logged |
| Rate limiting | None | 5 OTP attempts / 15 min / phone |
| Security headers | None | Helmet.js (HSTS, CSP, X-Frame-Options) |
| Token in body | `{ token: "..." }` in JSON body | `Authorization: Bearer <token>` header |
| Token expiry | Never expires | 30-day expiry, auto-invalidated |
| Error messages | Raw DB errors to client | Generic messages only |
| PII in logs | Full phone numbers logged | Masked: `+91XXXXX7210` |
| SMS raw data stored | Full SMS text in DB | Only parsed fields (amount, merchant, date) |
| Audit trail | None | `audit_logs` table for all sensitive actions |
| DPDP Act | No compliance | Access/Deletion/Consent endpoints added |
| HTTPS enforcement | Not enforced | Redirects HTTP → HTTPS in production |
| Request size limit | Unlimited | 50KB max body |
| Input validation | None | `express-validator` on all inputs |

#### Android App
| Fix | Before | After |
|---|---|---|
| Token storage | Plaintext SharedPreferences | EncryptedSharedPreferences (AES-256-GCM, Android Keystore) |
| Certificate pinning | None | OkHttp CertificatePinner (production builds) |
| Backup | `allowBackup=true` | `allowBackup=false` + data_extraction_rules.xml |
| TLS enforcement | Not enforced | `network_security_config.xml` blocks HTTP |
| SMS receiver priority | 999 (interfered with bank apps) | 0 (normal priority) |
| Sensitive logs | Token/OTP in logcat | `BuildConfig.DEBUG` guard on all sensitive logs |
| Token in request | JSON body `{ token }` | `Authorization: Bearer` header |

---

## Remaining Recommendations (not yet implemented)

### High Priority
1. **OTP via SMS fallback** — if WhatsApp fails, send OTP via SMS (Twilio SMS API)
2. **Token refresh flow** — auto-renew before 30-day expiry without re-OTP
3. **Duplicate SMS detection** — use bank ref number to prevent double-logging
4. **SMS retry queue** — persist failed forwards in local SQLite, retry on network
5. **Biometric lock** — optional fingerprint to open the app (Android BiometricPrompt)
6. **Root detection** — warn users on rooted phones (token at higher risk)

### Medium Priority
7. **Rate limit by phone** (not just IP) — prevents SIM-swap attacks
8. **Request signing** — HMAC-SHA256 of request body + timestamp to prevent replay
9. **Family member OTP confirmation** — require OTP before adding family member
10. **Automated data deletion job** — process `deletion_requests` table nightly

### Compliance TODO Before Public Launch
- [ ] **Privacy Policy page** (required by DPDP Act, App stores)
- [ ] **Terms of Service page**
- [ ] **Grievance Officer contact** (required under IT Rules — must be Indian resident)
- [ ] **Data Processing Agreement** with Twilio, OpenAI, Anthropic, Supabase
- [ ] **Vulnerability Disclosure Policy**
- [ ] Register with **Account Aggregator (AA) framework** if you want direct bank integration (long-term)

---

## Security Contact

For security issues, email: **security@yourdomain.com**
Response time: Within 48 hours

---

## Third-Party Security Notes

| Service | Data sent | Stored in India? | Notes |
|---|---|---|---|
| **Twilio** | Phone numbers, WhatsApp messages | No (US) | Use WhatsApp Business API — Twilio is WhatsApp's official partner |
| **OpenAI (Whisper)** | Voice audio files | No (US) | Only for transcription; audio deleted after. Consider self-hosting Whisper. |
| **Anthropic Claude** | Expense text in Hindi/English | No (US) | No PII sent — only expense descriptions like "chai 30" |
| **Supabase** | All user + expense data | Set to Mumbai (ap-south-1) | RBI compliant if Mumbai region selected |
| **Railway** | Logs, code | Select India region | Code only; no user data stored here |
