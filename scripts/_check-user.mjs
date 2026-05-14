import { createClient } from '@supabase/supabase-js'
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(url, key, { auth: { persistSession: false } })

const email = 'dat.le@mottafinancial.com'

// 1. List users by email
const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listErr) { console.error('listErr', listErr); process.exit(1) }
const matches = list.users.filter(u => (u.email || '').toLowerCase() === email)
console.log(`Found ${matches.length} matching auth.users records for ${email}`)
for (const u of matches) {
  console.log('---')
  console.log('id:', u.id)
  console.log('email:', u.email)
  console.log('email_confirmed_at:', u.email_confirmed_at)
  console.log('phone_confirmed_at:', u.phone_confirmed_at)
  console.log('confirmed_at:', u.confirmed_at)
  console.log('last_sign_in_at:', u.last_sign_in_at)
  console.log('created_at:', u.created_at)
  console.log('banned_until:', u.banned_until)
  console.log('deleted_at:', u.deleted_at)
  console.log('is_sso_user:', u.is_sso_user)
  console.log('is_anonymous:', u.is_anonymous)
  console.log('aud:', u.aud)
  console.log('role:', u.role)
  console.log('app_metadata:', JSON.stringify(u.app_metadata))
  console.log('user_metadata keys:', Object.keys(u.user_metadata || {}))
  console.log('identities:', (u.identities || []).map(i => ({ provider: i.provider, identity_id: i.identity_id, email: i.identity_data?.email, last_sign_in_at: i.last_sign_in_at })))
}

// 2. Check team_members row
const { data: tm } = await supabase.from('team_members').select('id,email,auth_user_id,is_active,is_service_account,role,full_name').eq('email', email).maybeSingle()
console.log('\nteam_members row:', tm)

// 3. Check if there is a mismatch / orphan
if (tm && matches.length) {
  const authIds = matches.map(m => m.id)
  console.log('\nauth.users IDs:', authIds)
  console.log('team_members.auth_user_id:', tm.auth_user_id)
  console.log('Match?', authIds.includes(tm.auth_user_id))
}
