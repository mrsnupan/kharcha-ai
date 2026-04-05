-- KharchaAI Database Schema
-- Run this in your Supabase SQL editor

-- ============================================================
-- FAMILIES
-- ============================================================
CREATE TABLE IF NOT EXISTS families (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_number   TEXT UNIQUE NOT NULL,  -- "whatsapp:+919876543210"
  name              TEXT,
  family_id         UUID REFERENCES families(id) ON DELETE SET NULL,
  device_token      TEXT,                  -- SHA-256 hash of Android app token
  token_expires_at  TIMESTAMPTZ,           -- token expiry (30 days from login)
  consent_given_at  TIMESTAMPTZ,           -- DPDP Act: when user gave consent
  data_deletion_requested_at TIMESTAMPTZ, -- DPDP Act: erasure request timestamp
  -- Weekly report schedule preference
  report_day        INTEGER NOT NULL DEFAULT 0,    -- 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
  report_hour       INTEGER NOT NULL DEFAULT 8,    -- 0–23 (IST)
  report_enabled    BOOLEAN NOT NULL DEFAULT true, -- false = opted out
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_whatsapp ON users(whatsapp_number);
CREATE INDEX IF NOT EXISTS idx_users_family   ON users(family_id);
CREATE INDEX IF NOT EXISTS idx_users_token    ON users(device_token);

-- ============================================================
-- OTP STORE (replaces in-memory Map — survives server restarts)
-- Rows auto-cleaned by cleanup job or DELETE on verify
-- ============================================================
CREATE TABLE IF NOT EXISTS otp_store (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL UNIQUE,        -- normalized: +91XXXXXXXXXX
  otp_hash    TEXT NOT NULL,               -- SHA-256 hash of OTP (never store plaintext)
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-expire: run this as a cron or let cleanup handle it
-- CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_store(expires_at);

-- ============================================================
-- EXPENSES
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount           NUMERIC(12, 2) NOT NULL,
  category         TEXT NOT NULL DEFAULT 'other',
  description      TEXT,
  source           TEXT NOT NULL DEFAULT 'chat',  -- 'chat' | 'sms' | 'voice'
  raw_input        TEXT,                           -- original message (chat/voice transcript only; NOT full bank SMS)
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_user     ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date     ON expenses(transaction_date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_source   ON expenses(source);

-- ============================================================
-- BUDGETS
-- ============================================================
CREATE TABLE IF NOT EXISTS budgets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  family_id     UUID REFERENCES families(id) ON DELETE CASCADE,
  category      TEXT NOT NULL DEFAULT 'total',
  monthly_limit NUMERIC(12, 2) NOT NULL,
  month         INTEGER NOT NULL,  -- 1–12
  year          INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, category, month, year)
);

CREATE INDEX IF NOT EXISTS idx_budgets_user  ON budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_budgets_month ON budgets(month, year);

-- ============================================================
-- SMS LOGS
-- Stores only metadata + parsed data — NOT the full raw SMS
-- (raw SMS contains account numbers — store only what you need)
-- ============================================================
CREATE TABLE IF NOT EXISTS sms_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  sender_id   TEXT,                        -- e.g. "HDFCBK"
  parsed_data JSONB,                       -- extracted: amount, description, type, date
  status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'logged' | 'failed' | 'ignored'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- raw_sms intentionally omitted — contains sensitive bank data
  -- if needed for debugging, add temporarily and delete after
);

-- ============================================================
-- AUDIT LOGS  (DPDP Act + CERT-In compliance)
-- Immutable log of all sensitive actions
-- CERT-In mandates 180-day log retention
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,   -- 'login' | 'logout' | 'expense_create' | 'data_export' | 'data_delete'
  meta       JSONB,           -- e.g. { phone: "+91XXXXX210" } — always masked
  ip_hash    TEXT,            -- SHA-256 of IP address (store hash, not raw IP — DPDP)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_date   ON audit_logs(created_at);

-- ============================================================
-- CONSENT LOG  (DPDP Act 2023 — Section 6: Consent)
-- Every time user gives or withdraws consent
-- ============================================================
CREATE TABLE IF NOT EXISTS consent_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,   -- 'given' | 'withdrawn'
  purpose    TEXT NOT NULL,   -- 'expense_tracking' | 'sms_processing' | 'analytics'
  version    TEXT NOT NULL DEFAULT '1.0',  -- privacy policy version
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- DATA DELETION REQUESTS  (DPDP Act: Right to Erasure)
-- ============================================================
CREATE TABLE IF NOT EXISTS deletion_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'completed'
);

-- ============================================================
-- EMIs — Home loan, car loan, personal loan installments
-- ============================================================
CREATE TABLE IF NOT EXISTS emis (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,                -- "Home Loan", "Car Loan EMI"
  amount     NUMERIC(12, 2) NOT NULL,
  due_day    INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31), -- day of month
  start_date DATE,
  end_date   DATE,                         -- null = ongoing
  status     TEXT NOT NULL DEFAULT 'active', -- active | paused | completed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emis_user   ON emis(user_id);
CREATE INDEX IF NOT EXISTS idx_emis_status ON emis(status);

-- ============================================================
-- SAVINGS GOALS — "Goa trip 20000", "New phone 15000"
-- ============================================================
CREATE TABLE IF NOT EXISTS savings_goals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,            -- "Goa Trip", "New Phone"
  target_amount  NUMERIC(12, 2) NOT NULL,
  current_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  deadline       DATE,                     -- optional target date
  status         TEXT NOT NULL DEFAULT 'active', -- active | completed | cancelled
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_goals_user   ON savings_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_status ON savings_goals(status);

-- ============================================================
-- REMINDERS — EMI due, recharge due, bill due
-- ============================================================
CREATE TABLE IF NOT EXISTS reminders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type               TEXT NOT NULL,        -- 'emi' | 'recharge' | 'bill' | 'custom'
  name               TEXT NOT NULL,        -- "Jio Recharge", "Home Loan EMI"
  amount             NUMERIC(12, 2),
  due_date           DATE NOT NULL,
  remind_days_before INTEGER NOT NULL DEFAULT 2,
  notified           BOOLEAN NOT NULL DEFAULT false,
  recurring          TEXT,                 -- 'monthly' | 'yearly' | null
  emi_id             UUID REFERENCES emis(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reminders_user     ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due      ON reminders(due_date);
CREATE INDEX IF NOT EXISTS idx_reminders_notified ON reminders(notified);

-- ============================================================
-- INCOMES — Salary, freelance, rent, any money received
-- ============================================================
CREATE TABLE IF NOT EXISTS incomes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount           NUMERIC(12, 2) NOT NULL,
  category         TEXT NOT NULL DEFAULT 'other',
                   -- salary | freelance | business | rent | investment | transfer | refund | other
  description      TEXT,
  source           TEXT NOT NULL DEFAULT 'chat',   -- 'chat' | 'sms' | 'voice'
  raw_input        TEXT,
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incomes_user ON incomes(user_id);
CREATE INDEX IF NOT EXISTS idx_incomes_date ON incomes(transaction_date);
CREATE INDEX IF NOT EXISTS idx_incomes_category ON incomes(category);

-- ============================================================
-- KHATA (LEDGER) — Kirana store credit/debit tracking
-- ============================================================

-- Customers of a kirana shop owner
CREATE TABLE IF NOT EXISTS khata_customers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- shop owner's user id
  name         TEXT NOT NULL,              -- customer name e.g. "Ashish"
  mobile       TEXT,                       -- customer WhatsApp: "+919876543210"
  total_due    NUMERIC(12, 2) DEFAULT 0,   -- running balance (positive = customer owes)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_khata_customers_owner  ON khata_customers(owner_id);
CREATE INDEX IF NOT EXISTS idx_khata_customers_mobile ON khata_customers(mobile);
CREATE UNIQUE INDEX IF NOT EXISTS idx_khata_customers_owner_name ON khata_customers(owner_id, LOWER(name));

-- Individual credit/debit entries per customer
CREATE TABLE IF NOT EXISTS khata_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL REFERENCES khata_customers(id) ON DELETE CASCADE,
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('credit', 'payment')),
                                           -- credit = gave goods/loan (customer owes more)
                                           -- payment = received money (customer owes less)
  amount       NUMERIC(12, 2) NOT NULL,
  description  TEXT,                       -- e.g. "kirana saman", "diwali advance"
  entry_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_khata_entries_customer ON khata_entries(customer_id);
CREATE INDEX IF NOT EXISTS idx_khata_entries_owner    ON khata_entries(owner_id);
CREATE INDEX IF NOT EXISTS idx_khata_entries_date     ON khata_entries(entry_date);

-- ============================================================
-- TAX DEDUCTIONS  (80C, 80D, 80E, 24b, 80CCD, 80G, 80TTA)
-- ============================================================
CREATE TABLE IF NOT EXISTS tax_deductions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section          TEXT NOT NULL,    -- '80C' | '80D_self' | '80D_parents' | '80E' | '24b' | '80CCD' | '80G' | '80TTA'
  sub_category     TEXT,             -- 'ppf' | 'elss' | 'lic' | 'epf' | 'health_self' | 'education_loan' | etc.
  amount           NUMERIC(12, 2) NOT NULL,
  description      TEXT,             -- e.g. "LIC Premium FY 2024-25"
  financial_year   TEXT NOT NULL DEFAULT '2024-25',  -- '2024-25' | '2025-26'
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tax_deductions_user ON tax_deductions(user_id);
CREATE INDEX IF NOT EXISTS idx_tax_deductions_fy   ON tax_deductions(financial_year);
CREATE INDEX IF NOT EXISTS idx_tax_deductions_sec  ON tax_deductions(section);

-- ============================================================
-- GST EXPENSES  (Phase 3 — business/freelance users)
-- ============================================================
CREATE TABLE IF NOT EXISTS gst_expenses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_amount      NUMERIC(12, 2) NOT NULL,    -- amount BEFORE GST
  gst_rate         NUMERIC(5, 2) NOT NULL,     -- 5 | 12 | 18 | 28
  gst_amount       NUMERIC(12, 2) NOT NULL,    -- GST component
  total_amount     NUMERIC(12, 2) NOT NULL,    -- base + gst
  vendor_gstin     TEXT,                       -- optional vendor GSTIN
  invoice_number   TEXT,
  category         TEXT NOT NULL DEFAULT 'other',
  description      TEXT,
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gst_expenses_user ON gst_expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_gst_expenses_date ON gst_expenses(transaction_date);

-- ============================================================
-- ADD TAX PROFILE COLUMNS TO USERS
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tax_regime       TEXT DEFAULT 'new',      -- 'old' | 'new'
  ADD COLUMN IF NOT EXISTS income_type      TEXT DEFAULT 'salaried', -- 'salaried' | 'freelance' | 'business'
  ADD COLUMN IF NOT EXISTS has_senior_parent BOOLEAN DEFAULT false;

-- ============================================================
-- HELPER: get_family_member_ids(family_id)
-- ============================================================
CREATE OR REPLACE FUNCTION get_family_member_ids(p_family_id UUID)
RETURNS TABLE(user_id UUID) AS $$
  SELECT id FROM users WHERE family_id = p_family_id;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- ROW-LEVEL SECURITY (RLS) — users can only see their own data
-- Enable in Supabase: each table → Authentication → Enable RLS
-- ============================================================
-- ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "own_expenses" ON expenses
--   FOR ALL USING (auth.uid()::text = user_id::text);
--
-- (Uncomment and adapt if using Supabase Auth.
--  With custom JWT/token auth, enforce at application layer.)
