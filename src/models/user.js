const supabase = require('./db');

/**
 * Find or create a user by WhatsApp number.
 * Returns the user row.
 */
async function findOrCreateUser(whatsappNumber) {
  // Normalize: always store with "whatsapp:" prefix
  const number = whatsappNumber.startsWith('whatsapp:')
    ? whatsappNumber
    : `whatsapp:${whatsappNumber}`;

  const { data: existing, error: fetchErr } = await supabase
    .from('users')
    .select('*')
    .eq('whatsapp_number', number)
    .single();

  if (fetchErr && fetchErr.code !== 'PGRST116') throw fetchErr; // PGRST116 = row not found
  if (existing) return { ...existing, _isNew: false };

  // Create new user (and a personal family for them)
  const { data: family, error: famErr } = await supabase
    .from('families')
    .insert({ name: 'My Family' })
    .select()
    .single();
  if (famErr) throw famErr;

  const { data: user, error: userErr } = await supabase
    .from('users')
    .insert({ whatsapp_number: number, family_id: family.id })
    .select()
    .single();
  if (userErr) throw userErr;

  return { ...user, _isNew: true };
}

/**
 * Get user by WhatsApp number (returns null if not found)
 */
async function getUserByNumber(whatsappNumber) {
  const number = whatsappNumber.startsWith('whatsapp:')
    ? whatsappNumber
    : `whatsapp:${whatsappNumber}`;

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('whatsapp_number', number)
    .single();

  if (error && error.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

/**
 * Add a family member by linking two users to the same family
 */
async function addFamilyMember(ownerUserId, memberNumber) {
  // Get owner's family
  const { data: owner, error: ownerErr } = await supabase
    .from('users')
    .select('family_id')
    .eq('id', ownerUserId)
    .single();
  if (ownerErr) throw ownerErr;

  // Find or create the member user
  const member = await findOrCreateUser(memberNumber);

  // Update member's family_id to owner's family
  const { error: updateErr } = await supabase
    .from('users')
    .update({ family_id: owner.family_id })
    .eq('id', member.id);
  if (updateErr) throw updateErr;

  return member;
}

/**
 * Get all family members for a given family_id
 */
async function getFamilyMembers(familyId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('family_id', familyId);
  if (error) throw error;
  return data || [];
}

/**
 * Update user's display name
 */
async function updateUserName(userId, name) {
  const { data, error } = await supabase
    .from('users')
    .update({ name })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  findOrCreateUser,
  getUserByNumber,
  addFamilyMember,
  getFamilyMembers,
  updateUserName
};
