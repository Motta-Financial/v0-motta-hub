import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getAllAIConfigs, clearConfigCache, ALL_MODELS } from "@/lib/ai/config"

/**
 * GET /api/admin/ai/config
 *
 * Returns all AI configurations + available models for the admin UI.
 */
export async function GET() {
  try {
    const configs = await getAllAIConfigs()
    return NextResponse.json({
      configs,
      models: ALL_MODELS,
    })
  } catch (error) {
    console.error("[api/admin/ai/config] GET error:", error)
    return NextResponse.json(
      { error: "Failed to fetch configurations" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/admin/ai/config
 *
 * Updates an AI configuration (model, prompt, isActive).
 * Body: { useCase, model?, systemPrompt?, isActive? }
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { useCase, model, systemPrompt, isActive } = body

    if (!useCase) {
      return NextResponse.json(
        { error: "useCase is required" },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Build the update object with only provided fields
    const updates: Record<string, unknown> = {}
    if (model !== undefined) updates.model = model || null
    if (systemPrompt !== undefined) updates.system_prompt = systemPrompt || null
    if (isActive !== undefined) updates.is_active = isActive

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from("ai_configurations")
      .update(updates)
      .eq("use_case", useCase)

    if (error) {
      console.error("[api/admin/ai/config] PATCH error:", error)
      return NextResponse.json(
        { error: "Failed to update configuration" },
        { status: 500 }
      )
    }

    // Clear the in-memory cache so the change takes effect immediately
    clearConfigCache()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[api/admin/ai/config] PATCH error:", error)
    return NextResponse.json(
      { error: "Failed to update configuration" },
      { status: 500 }
    )
  }
}
