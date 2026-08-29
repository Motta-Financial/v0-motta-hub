// One-off script: create a Supabase Auth account for Troy Travassos and
// link it to his existing public.team_members row (auth_user_id was null).
// Run with:
//   node --env-file-if-exists=/vercel/share/.env.project scripts/setup-troy-auth.mjs
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing Supabase environment variables")
}

const admin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const TEAM_MEMBER_ID = "1c54a34c-83a8-4e90-88bf-5a85d392bcac"
const EMAIL = "Troy.Travassos@mottafinancial.com"
const FULL_NAME = "Troy Travassos"

function generateTempPassword() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%"
  let password = ""
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

const tempPassword = generateTempPassword()

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: tempPassword,
  email_confirm: true,
  user_metadata: {
    full_name: FULL_NAME,
    team_member_id: TEAM_MEMBER_ID,
  },
})

if (createErr) {
  console.error("[v0] Failed to create auth user:", createErr.message)
  process.exit(1)
}

const { error: updateErr } = await admin
  .from("team_members")
  .update({ auth_user_id: created.user.id })
  .eq("id", TEAM_MEMBER_ID)

if (updateErr) {
  console.error("[v0] Auth user created but failed to link team_members row:", updateErr.message)
  process.exit(1)
}

console.log("[v0] Success. Auth user id:", created.user.id)
console.log("[v0] TEMP_PASSWORD:", tempPassword)
