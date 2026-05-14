import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

/**
 * POST /api/admin/migrate-hero-profiles
 *
 * Adds the hero_profile_slug column to team_members and maps existing
 * hero profiles to team members by name.
 */
export async function POST() {
  console.log("[v0] Starting hero profile migration")
  
  let supabase
  try {
    supabase = await createAdminClient()
    console.log("[v0] Supabase client created")
  } catch (e) {
    console.error("[v0] Failed to create admin client:", e)
    return NextResponse.json(
      { error: `Failed to create Supabase client: ${e instanceof Error ? e.message : "Unknown"}` },
      { status: 500 }
    )
  }

  // Hero profile mappings: name patterns -> slug
  // These match the slugs defined in lib/motta-alliance/hero-profiles.ts
  const heroMappings = [
    { slug: "dat-le", patterns: ["Dat Le"] },
    { slug: "mark-dwyer", patterns: ["Mark Dwyer"] },
    { slug: "caleb-long", patterns: ["Caleb Long"] },
    { slug: "amy-sparaco", patterns: ["Amy Sparaco"] },
    { slug: "micaela-palacios", patterns: ["Micaela Palacios"] },
    { slug: "ocp-andrew-gianares", patterns: ["Andrew Gianares", "Andrew \"OCP\" Gianares"] },
    { slug: "samprina-zekio", patterns: ["Samprina Zekio"] },
    // P24 Shadow Task Force is shared by Ganesh & Thameem - handled separately
  ]

  const results: { name: string; slug: string; success: boolean; error?: string }[] = []

  try {
    // First, check if column exists by trying to select it
    const { error: checkError } = await supabase
      .from("team_members")
      .select("hero_profile_slug")
      .limit(1)

    // If the column doesn't exist, we need to add it via raw SQL
    // Since we can't run DDL through the JS client, we'll just update existing rows
    // The column needs to be added manually via Supabase dashboard or MCP

    if (checkError && checkError.message.includes("hero_profile_slug")) {
      return NextResponse.json(
        {
          error: "Column hero_profile_slug does not exist. Please run this SQL in Supabase SQL Editor first:\n\nALTER TABLE team_members ADD COLUMN IF NOT EXISTS hero_profile_slug TEXT;",
          sqlToRun: "ALTER TABLE team_members ADD COLUMN IF NOT EXISTS hero_profile_slug TEXT;",
        },
        { status: 400 }
      )
    }

    // Get all team members
    const { data: teamMembers, error: fetchError } = await supabase
      .from("team_members")
      .select("id, full_name, hero_profile_slug")
      .eq("is_active", true)

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    // Map each hero profile to a team member
    for (const mapping of heroMappings) {
      const matchedMember = teamMembers?.find((member) =>
        mapping.patterns.some(
          (pattern) => member.full_name?.toLowerCase() === pattern.toLowerCase()
        )
      )

      if (matchedMember) {
        const { error: updateError } = await supabase
          .from("team_members")
          .update({ hero_profile_slug: mapping.slug })
          .eq("id", matchedMember.id)

        results.push({
          name: matchedMember.full_name,
          slug: mapping.slug,
          success: !updateError,
          error: updateError?.message,
        })
      } else {
        results.push({
          name: mapping.patterns[0],
          slug: mapping.slug,
          success: false,
          error: "No matching team member found",
        })
      }
    }

    const successCount = results.filter((r) => r.success).length
    const failCount = results.filter((r) => !r.success).length

    return NextResponse.json({
      message: `Migration complete. ${successCount} mapped, ${failCount} failed.`,
      results,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
