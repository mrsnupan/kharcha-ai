const supabase = require('./db');

// ──────────────────────────────────────────────────────────
// CUSTOMER OPERATIONS
// ──────────────────────────────────────────────────────────

/**
 * Find customer by name (case-insensitive fuzzy match) for an owner.
 * Returns first match or null.
 */
async function findCustomerByName(ownerId, name) {
  const { data, error } = await supabase
    .from('khata_customers')
    .select('*')
    .eq('owner_id', ownerId)
    .ilike('name', `%${name.trim()}%`)
    .limit(1)
    .single();

  if (error && error.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

/**
 * Find customer by mobile number for an owner.
 */
async function findCustomerByMobile(ownerId, mobile) {
  const normalized = normalizePhone(mobile);
  const { data, error } = await supabase
    .from('khata_customers')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('mobile', normalized)
    .single();

  if (error && error.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

/**
 * Find or create a customer by name. Returns { customer, isNew }.
 */
async function findOrCreateCustomer(ownerId, name, mobile = null) {
  const existing = await findCustomerByName(ownerId, name);
  if (existing) {
    // Update mobile if newly provided
    if (mobile && !existing.mobile) {
      await supabase
        .from('khata_customers')
        .update({ mobile: normalizePhone(mobile) })
        .eq('id', existing.id);
    }
    return { customer: existing, isNew: false };
  }

  const { data, error } = await supabase
    .from('khata_customers')
    .insert({
      owner_id: ownerId,
      name: name.trim(),
      mobile: mobile ? normalizePhone(mobile) : null,
      total_due: 0
    })
    .select()
    .single();

  if (error) throw error;
  return { customer: data, isNew: true };
}

/**
 * List all customers for an owner with their outstanding balance.
 */
async function listCustomers(ownerId) {
  const { data, error } = await supabase
    .from('khata_customers')
    .select('*')
    .eq('owner_id', ownerId)
    .order('total_due', { ascending: false });

  if (error) throw error;
  return data || [];
}

// ──────────────────────────────────────────────────────────
// LEDGER ENTRY OPERATIONS
// ──────────────────────────────────────────────────────────

/**
 * Add a ledger entry (credit or payment) and update running balance.
 * type: 'credit'  = gave goods/loan → customer owes more
 * type: 'payment' = received money  → customer owes less
 */
async function addEntry(ownerId, customerId, type, amount, description = '') {
  // Insert entry
  const { data: entry, error: entryErr } = await supabase
    .from('khata_entries')
    .insert({
      customer_id: customerId,
      owner_id: ownerId,
      type,
      amount,
      description
    })
    .select()
    .single();

  if (entryErr) throw entryErr;

  // Update running balance
  const delta = type === 'credit' ? amount : -amount;
  const { data: customer, error: balErr } = await supabase
    .rpc('increment_khata_balance', { p_customer_id: customerId, p_delta: delta });

  // Fallback if RPC not available — fetch and update manually
  if (balErr) {
    const { data: cust } = await supabase
      .from('khata_customers')
      .select('total_due')
      .eq('id', customerId)
      .single();

    const newBalance = Number(cust?.total_due || 0) + delta;
    await supabase
      .from('khata_customers')
      .update({ total_due: newBalance })
      .eq('id', customerId);
  }

  return entry;
}

/**
 * Get customer's full entry history (newest first).
 */
async function getCustomerHistory(customerId, limit = 50) {
  const { data, error } = await supabase
    .from('khata_entries')
    .select('*')
    .eq('customer_id', customerId)
    .order('entry_date', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Get customer's current balance.
 */
async function getCustomerBalance(ownerId, customerId) {
  const { data, error } = await supabase
    .from('khata_customers')
    .select('total_due, name, mobile')
    .eq('id', customerId)
    .eq('owner_id', ownerId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get full ledger summary for owner — all customers with balances.
 */
async function getLedgerSummary(ownerId) {
  const { data, error } = await supabase
    .from('khata_customers')
    .select('id, name, mobile, total_due, created_at')
    .eq('owner_id', ownerId)
    .order('total_due', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Total outstanding across all customers.
 */
async function getTotalOutstanding(ownerId) {
  const customers = await getLedgerSummary(ownerId);
  return customers.reduce((sum, c) => sum + Number(c.total_due || 0), 0);
}

// ──────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.startsWith('+')) return phone.replace(/\s/g, '');
  return `+${digits}`;
}

module.exports = {
  findCustomerByName,
  findCustomerByMobile,
  findOrCreateCustomer,
  listCustomers,
  addEntry,
  getCustomerHistory,
  getCustomerBalance,
  getLedgerSummary,
  getTotalOutstanding
};
