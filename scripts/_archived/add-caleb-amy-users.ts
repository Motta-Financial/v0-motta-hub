/**
 * Script to check Supabase Auth users and add Caleb & Amy to the hub
 * Run with: npx tsx scripts/add-caleb-amy-users.ts
 */

import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

async function main() {
  console.log("=== Checking Supabase Auth Users ===\n")

  // 1. List all auth users
  const { data: authData, error: authError } = await supabase.auth.admin.listUsers()
  if (authError) {
    console.error("Error listing auth users:", authError.message)
    process.exit(1)
  }

  const authUsers = authData?.users || []
  console.log(`Total Auth Users: ${authUsers.length}\n`)

  // Display all auth users
  console.log("All Auth Users:")
  console.log("-".repeat(80))
  for (const user of authUsers) {
    const name = user.user_metadata?.full_name || user.email?.split("@")[0] || "Unknown"
    console.log(`  ${name.padEnd(25)} | ${user.email?.padEnd(35)} | ID: ${user.id.slice(0, 8)}...`)
  }
  console.log()

  // 2. Find Caleb & Amy in auth users
  const calebUser = authUsers.find(
    (u) =>
      u.email?.toLowerCase().includes("caleb") ||
      u.user_metadata?.full_name?.toLowerCase().includes("caleb")
  )
  const amyUser = authUsers.find(
    (u) =>
      u.email?.toLowerCase().includes("amy") ||
      u.user_metadata?.full_name?.toLowerCase().includes("amy")
  )

  console.log("=== Looking for Caleb & Amy ===\n")
  console.log("Caleb:", calebUser ? `Found - ${calebUser.email}` : "Not found in Auth")
  console.log("Amy:", amyUser ? `Found - ${amyUser.email}` : "Not found in Auth")
  console.log()

  // 3. Check existing team_members
  const { data: teamMembers, error: tmError } = await supabase
    .from("team_members")
    .select("id, email, full_name, auth_user_id, is_active")

  if (tmError) {
    console.error("Error fetching team_members:", tmError.message)
    process.exit(1)
  }

  console.log(`Total Team Members: ${teamMembers?.length || 0}\n`)

  // Check if Caleb & Amy already exist in team_members
  const calebMember = teamMembers?.find(
    (tm) =>
      tm.email?.toLowerCase().includes("caleb") ||
      tm.full_name?.toLowerCase().includes("caleb")
  )
  const amyMember = teamMembers?.find(
    (tm) =>
      tm.email?.toLowerCase().includes("amy") ||
      tm.full_name?.toLowerCase().includes("amy")
  )

  console.log("=== Team Members Status ===\n")
  console.log(
    "Caleb in team_members:",
    calebMember ? `Yes - ${calebMember.full_name} (${calebMember.email})` : "No"
  )
  console.log(
    "Amy in team_members:",
    amyMember ? `Yes - ${amyMember.full_name} (${amyMember.email})` : "No"
  )
  console.log()

  // 4. Add users to team_members if they exist in auth but not in team_members
  const usersToAdd: Array<{
    auth_id: string
    email: string
    full_name: string
  }> = []

  if (calebUser && !calebMember) {
    usersToAdd.push({
      auth_id: calebUser.id,
      email: calebUser.email || "",
      full_name: calebUser.user_metadata?.full_name || "Caleb",
    })
  }

  if (amyUser && !amyMember) {
    usersToAdd.push({
      auth_id: amyUser.id,
      email: amyUser.email || "",
      full_name: amyUser.user_metadata?.full_name || "Amy",
    })
  }

  // Link auth users to existing team_members if needed
  const membersToLink: Array<{
    team_member_id: string
    auth_id: string
    email: string
  }> = []

  if (calebUser && calebMember && !calebMember.auth_user_id) {
    membersToLink.push({
      team_member_id: calebMember.id,
      auth_id: calebUser.id,
      email: calebMember.email,
    })
  }

  if (amyUser && amyMember && !amyMember.auth_user_id) {
    membersToLink.push({
      team_member_id: amyMember.id,
      auth_id: amyUser.id,
      email: amyMember.email,
    })
  }

  console.log("=== Actions to Take ===\n")
  console.log("Users to add to team_members:", usersToAdd.length)
  console.log("Members to link to auth:", membersToLink.length)
  console.log()

  // 5. Perform the additions
  for (const user of usersToAdd) {
    const nameParts = user.full_name.split(" ")
    const firstName = nameParts[0] || ""
    const lastName = nameParts.slice(1).join(" ") || ""

    console.log(`Adding ${user.full_name} (${user.email}) to team_members...`)

    const { data: newMember, error: insertError } = await supabase
      .from("team_members")
      .insert({
        email: user.email,
        first_name: firstName,
        last_name: lastName,
        full_name: user.full_name,
        auth_user_id: user.auth_id,
        role: "Team Member",
        department: "Unassigned",
        is_active: true,
      })
      .select("id, full_name, email")
      .single()

    if (insertError) {
      console.error(`  Error: ${insertError.message}`)
    } else {
      console.log(`  Success! Team member ID: ${newMember?.id}`)
    }
  }

  // 6. Perform the links
  for (const link of membersToLink) {
    console.log(`Linking ${link.email} to auth user...`)

    const { error: updateError } = await supabase
      .from("team_members")
      .update({ auth_user_id: link.auth_id })
      .eq("id", link.team_member_id)

    if (updateError) {
      console.error(`  Error: ${updateError.message}`)
    } else {
      console.log(`  Success!`)
    }
  }

  // 7. Verify Tommy Awards eligibility
  console.log("\n=== Tommy Awards Eligibility ===\n")

  // Get all active team members
  const { data: activeTm, error: activeErr } = await supabase
    .from("team_members")
    .select("id, full_name, email, is_active")
    .eq("is_active", true)
    .order("full_name")

  if (activeErr) {
    console.error("Error fetching active team members:", activeErr.message)
  } else {
    console.log("Active team members eligible for Tommy Awards:")
    for (const tm of activeTm || []) {
      const isCalebOrAmy =
        tm.full_name?.toLowerCase().includes("caleb") ||
        tm.full_name?.toLowerCase().includes("amy") ||
        tm.email?.toLowerCase().includes("caleb") ||
        tm.email?.toLowerCase().includes("amy")
      const marker = isCalebOrAmy ? " <-- " : ""
      console.log(`  ${tm.full_name?.padEnd(30)} | ${tm.email}${marker}`)
    }
  }

  console.log("\n=== Done ===")
}

main().catch(console.error)
