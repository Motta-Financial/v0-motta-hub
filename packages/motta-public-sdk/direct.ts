/**
 * Direct Supabase client for the marketing site. Uses the anon key
 * (set on the marketing project as NEXT_PUBLIC_SUPABASE_URL +
 * NEXT_PUBLIC_SUPABASE_ANON_KEY — same instance as the Hub).
 *
 * Anon RLS rules (see scripts/210_marketing_schema.sql):
 *   - marketing.blog_posts: SELECT where status='published'
 *   - marketing.case_studies: SELECT where status='published'
 *   - marketing.firm_stats_public_rpc(): EXECUTE (SECURITY DEFINER)
 *   - marketing.newsletter_subscribers: NO ACCESS (proxy via Hub)
 *
 * Anything that requires write or PII access goes through hubFetch().
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

// Cast to a relaxed type so the marketing repo can pass `schema:
// "marketing"` even though Supabase's generated types only know the
// public schema. The marketing repo is welcome to generate its own
// types from the live DB and replace `any` here.
let _singleton: SupabaseClient<any, any, any> | null = null

export function getPublicSupabase(): SupabaseClient<any, any, any> {
  if (_singleton) return _singleton
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    ""
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    ""
  if (!url || !key) {
    throw new Error(
      "@motta/public-sdk: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required " +
        "on the marketing project. They must point at the SAME Supabase instance as the Hub.",
    )
  }
  _singleton = createClient(url, key, {
    auth: { persistSession: false },
    db: { schema: "marketing" },
  })
  return _singleton
}

// ── Typed row shapes for autocomplete in the marketing repo ────────

export interface FirmStatsPublic {
  active_clients: number
  returns_filed_ytd: number
  states_served: number
  as_of: string
}

export interface BlogPost {
  id: string
  slug: string
  title: string
  subtitle: string | null
  excerpt: string | null
  body_md: string
  cover_image_url: string | null
  author_name: string | null
  author_role: string | null
  author_avatar_url: string | null
  status: "draft" | "scheduled" | "published" | "archived"
  published_at: string | null
  seo_title: string | null
  seo_description: string | null
  og_image_url: string | null
  tags: string[]
  service_focus: string | null
  created_at: string
  updated_at: string
}

export interface CaseStudy {
  id: string
  slug: string
  client_display_name: string
  industry: string | null
  quote: string | null
  attribution: string | null
  metrics: Array<{ label: string; value: number; unit?: string }>
  body_md: string | null
  cover_image_url: string | null
  service_focus: string | null
  status: "draft" | "published" | "archived"
  published_at: string | null
  created_at: string
  updated_at: string
}
