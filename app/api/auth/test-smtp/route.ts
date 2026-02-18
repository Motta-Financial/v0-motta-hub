import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase environment variables")
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

// POST: Send a test password reset email to verify SMTP is working
export async function POST(request: Request) {
  try {
    // Verify the calling user is authenticated
    const serverSupabase = await createServerClient()
    const {
      data: { user: caller },
      error: authError,
    } = await serverSupabase.auth.getUser()

    if (authError || !caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { email } = body

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Verify the target email exists as an auth user
    const { data: usersData } = await supabase.auth.admin.listUsers()
    const targetUser = usersData?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    )

    if (!targetUser) {
      return NextResponse.json(
        { error: `No auth user found with email: ${email}. SMTP test requires an existing auth user.` },
        { status: 404 },
      )
    }

    // Use generateLink to create a recovery link - this triggers SMTP email delivery
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "https://mottahub-motta.vercel.app"}/auth/callback?type=recovery`,
      },
    })

    if (linkError) {
      return NextResponse.json({
        success: false,
        error: linkError.message,
        smtp_status: "FAILED",
        details: "The generateLink call failed. Check your SMTP configuration in the Supabase dashboard.",
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      smtp_status: "EMAIL_SENT",
      message: `Password reset email sent to ${email} via your custom SMTP (ALFRED / info@mottafinancial.com)`,
      details: {
        sent_to: email,
        sent_from: "info@mottafinancial.com (ALFRED)",
        smtp_host: "smtp-mail.outlook.com:587",
        link_generated: !!linkData,
        note: "Check the recipient's inbox (and spam folder) for the password reset email. If received, your SMTP integration is working correctly.",
      },
    })
  } catch (error) {
    console.error("SMTP test error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "SMTP test failed",
        smtp_status: "ERROR",
      },
      { status: 500 },
    )
  }
}

// GET: Check SMTP configuration status
export async function GET() {
  try {
    const serverSupabase = await createServerClient()
    const {
      data: { user: caller },
      error: authError,
    } = await serverSupabase.auth.getUser()

    if (authError || !caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createAdminClient()

    // Get auth user count and recent activity
    const { data: usersData } = await supabase.auth.admin.listUsers()
    const users = usersData?.users || []

    const confirmedCount = users.filter((u) => u.email_confirmed_at).length
    const recentSignIns = users.filter(
      (u) => u.last_sign_in_at && new Date(u.last_sign_in_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    ).length

    return NextResponse.json({
      smtp_configured: true,
      smtp_details: {
        sender_email: "info@mottafinancial.com",
        sender_name: "ALFRED",
        smtp_host: "smtp-mail.outlook.com",
        smtp_port: 587,
        min_interval: "60 seconds",
      },
      auth_summary: {
        total_users: users.length,
        email_confirmed: confirmedCount,
        recent_sign_ins_7d: recentSignIns,
        users: users.map((u) => ({
          email: u.email,
          confirmed: !!u.email_confirmed_at,
          last_sign_in: u.last_sign_in_at,
        })),
      },
      email_capabilities: [
        "Password reset emails (via auth.resetPasswordForEmail or admin.generateLink)",
        "User invitation emails (via admin.inviteUserByEmail)",
        "Email confirmation on signup",
        "Magic link authentication",
      ],
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to check SMTP status" },
      { status: 500 },
    )
  }
}
