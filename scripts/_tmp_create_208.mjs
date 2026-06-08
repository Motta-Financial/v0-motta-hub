import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

const KARBON_BASE = "https://api.karbonhq.com/v3"
const cred = {
  AccessKey: process.env.KARBON_ACCESS_KEY,
  Authorization: `Bearer ${process.env.KARBON_BEARER_TOKEN}`,
  "Content-Type": "application/json",
}

const CONTACT_ID = "653e6f3c-f493-458e-baf8-9216c4bd576d" // John Arthun
const JOHN_KARBON_CONTACT_KEY = "WQBygfyXBt8"
const DRY = process.env.DRY === "1"

async function karbon(path, method, body) {
  const res = await fetch(`${KARBON_BASE}${path}`, {
    method,
    headers: cred,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch {}
  return { ok: res.ok, status: res.status, json, text }
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

function buildNoteBody(sub) {
  const p = []
  p.push("<p>A new intake form was submitted on <strong>June 3, 2026</strong> via the Motta Hub website (Both Personal &amp; Business).</p>")

  if (sub.karbon_work_item_url) {
    p.push("<h3>Work item</h3>")
    p.push(`<p>Karbon Work Item: <a href="${esc(sub.karbon_work_item_url)}">${esc(sub.karbon_work_item_key)}</a></p>`)
  }

  p.push("<h3>Prospect (owner)</h3>")
  p.push("<ul>")
  p.push(`<li><strong>Full name:</strong> ${esc(sub.submitter_full_name)}</li>`)
  p.push(`<li><strong>Email:</strong> ${esc(sub.submitter_email)}</li>`)
  p.push(`<li><strong>Phone:</strong> ${esc(sub.submitter_phone)}</li>`)
  p.push(`<li><strong>Location:</strong> ${esc([sub.submitter_city, sub.submitter_state, sub.submitter_zip].filter(Boolean).join(", "))}</li>`)
  p.push("</ul>")

  const services = (sub.services_requested ?? []).filter(Boolean)
  const entityTypes = (sub.entity_types ?? []).filter(Boolean)
  p.push("<h3>Services requested</h3>")
  p.push("<ul>")
  if (sub.service_focus) p.push(`<li><strong>Service focus:</strong> ${esc(sub.service_focus)}</li>`)
  if (sub.business_situation) p.push(`<li><strong>Business situation:</strong> ${esc(sub.business_situation)}</li>`)
  if (entityTypes.length) p.push(`<li><strong>Entity types:</strong> ${esc(entityTypes.join(", "))}</li>`)
  p.push("</ul>")
  if (services.length) {
    p.push("<p><strong>Specifically:</strong></p><ul>")
    services.forEach((s) => p.push(`<li>${esc(s)}</li>`))
    p.push("</ul>")
  }

  p.push("<h3>Business</h3>")
  p.push("<ul>")
  p.push(`<li><strong>Name:</strong> ${esc(sub.business_name)}</li>`)
  if (sub.business_state) p.push(`<li><strong>State:</strong> ${esc(sub.business_state)}</li>`)
  if (sub.business_revenue_range) p.push(`<li><strong>Revenue range:</strong> ${esc(sub.business_revenue_range)}</li>`)
  if (sub.business_tax_classification) p.push(`<li><strong>Tax classification:</strong> ${esc(sub.business_tax_classification)}</li>`)
  p.push("</ul>")
  if (sub.business_summary) {
    p.push("<p><strong>Summary:</strong></p>")
    p.push(`<p>${esc(sub.business_summary).replace(/\n/g, "<br />")}</p>`)
  }

  // ALFRED enrichment summary + sources
  const enr = sub.enrichment || {}
  if (enr.summary) {
    p.push("<h3>ALFRED prospect research</h3>")
    p.push(`<p>${esc(enr.summary).replace(/\n/g, "<br />")}</p>`)
  }
  if (Array.isArray(enr.sources) && enr.sources.length) {
    p.push("<p><strong>Sources:</strong></p><ul>")
    enr.sources.forEach((s) => {
      if (s?.url) p.push(`<li><a href="${esc(s.url)}">${esc(s.title || s.url)}</a></li>`)
    })
    p.push("</ul>")
  }

  // ALFRED question research / suggested response
  const qr = sub.question_research || {}
  if (qr.summary) {
    p.push("<h3>ALFRED suggested response</h3>")
    p.push(`<p>${esc(qr.summary).replace(/\n/g, "<br />")}</p>`)
  }

  p.push("<hr />")
  p.push(`<p><em>Synced from Motta Hub — intake ${esc(sub.id)}.</em></p>`)
  return p.join("\n")
}

async function main() {
  // 0. Load the intake row (source of truth for the note)
  const { data: sub, error: subErr } = await supabase
    .from("jotform_intake_submissions")
    .select("*")
    .eq("contact_id", CONTACT_ID)
    .single()
  if (subErr || !sub) throw new Error(`Intake not found: ${subErr?.message}`)
  console.log(`[208] Intake: ${sub.business_name} — owner ${sub.submitter_full_name}`)

  // 1. Find-or-create the Hub organization
  let orgId = null
  let orgKarbonKey = null
  const { data: existingOrg } = await supabase
    .from("organizations")
    .select("id, name, karbon_organization_key")
    .ilike("name", "208 Mobile Detailing")
    .maybeSingle()

  if (existingOrg) {
    orgId = existingOrg.id
    orgKarbonKey = existingOrg.karbon_organization_key
    console.log(`[208] Hub org already exists: ${orgId} (karbon=${orgKarbonKey || "none"})`)
  } else if (DRY) {
    console.log("[208] DRY: would INSERT organization 208 Mobile Detailing")
  } else {
    const nowIso = new Date().toISOString()
    const { data: newOrg, error: insErr } = await supabase
      .from("organizations")
      .insert({
        name: "208 Mobile Detailing",
        entity_type: "Limited Liability Company (LLC)",
        primary_email: null,
        city: "Eagle",
        state: "Idaho",
        zip_code: "83616",
        country: "United States",
        status: "Active",
        source: "jotform_intake",
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id")
      .single()
    if (insErr) throw new Error(`Org insert failed: ${insErr.message}`)
    orgId = newOrg.id
    console.log(`[208] Created Hub org: ${orgId}`)
  }

  // 2. Create the organization in Karbon (if not already linked)
  if (!orgKarbonKey) {
    const body = {
      FullName: "208 Mobile Detailing",
      ContactType: "Client",
      RestrictionLevel: "Public",
      BusinessCards: [{ IsPrimaryCard: true, EmailAddresses: [], PhoneNumbers: [] }],
    }
    if (DRY) {
      console.log("[208] DRY: would POST /Organizations", JSON.stringify(body))
    } else {
      const r = await karbon("/Organizations", "POST", body)
      if (!r.ok || !r.json?.OrganizationKey) {
        throw new Error(`Karbon org create failed: ${r.status} ${r.text}`)
      }
      orgKarbonKey = r.json.OrganizationKey
      console.log(`[208] Created Karbon org: ${orgKarbonKey}`)
      await supabase
        .from("organizations")
        .update({
          karbon_organization_key: orgKarbonKey,
          karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/organizations/${orgKarbonKey}`,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", orgId)
    }
  }

  // 3. Link John -> org as Owner (deduped)
  if (orgId && !DRY) {
    const { data: link } = await supabase
      .from("contact_organizations")
      .select("id")
      .eq("contact_id", CONTACT_ID)
      .eq("organization_id", orgId)
      .maybeSingle()
    if (!link) {
      await supabase.from("contact_organizations").insert({
        contact_id: CONTACT_ID,
        organization_id: orgId,
        is_primary_contact: true,
        role_or_title: "Owner",
        ownership_percentage: 100,
      })
      console.log("[208] Linked John Arthun as Owner")
    } else {
      console.log("[208] Owner link already exists")
    }
    // Carry org onto the intake row
    if (!sub.organization_id) {
      await supabase.from("jotform_intake_submissions").update({ organization_id: orgId }).eq("id", sub.id)
      console.log("[208] Set intake.organization_id")
    }
  }

  // 4. Post the pinned intake+research note to BOTH the org and John's contact timelines
  const noteBody = buildNoteBody(sub)
  const timelines = []
  if (orgKarbonKey) timelines.push({ EntityType: "Organization", EntityKey: orgKarbonKey })
  timelines.push({ EntityType: "Contact", EntityKey: JOHN_KARBON_CONTACT_KEY })

  const notePayload = {
    Subject: "Intake Form & Research — 208 Mobile Detailing (John Arthun)",
    Body: noteBody,
    AuthorEmailAddress: process.env.RESEND_FROM_EMAIL || "noreply@mottafinancial.com",
    Timelines: timelines,
    IsPinned: true,
  }

  if (DRY) {
    console.log("[208] DRY: would POST /Notes to timelines:", JSON.stringify(timelines))
    console.log("[208] DRY: note body length:", noteBody.length)
    return
  }

  let r = await karbon("/Notes", "POST", notePayload)
  if (!r.ok) {
    console.warn(`[208] Pinned note POST failed (${r.status}) — retrying without IsPinned`)
    delete notePayload.IsPinned
    r = await karbon("/Notes", "POST", notePayload)
  }
  if (!r.ok) throw new Error(`Karbon note create failed: ${r.status} ${r.text}`)
  console.log(`[208] Posted note: ${r.json?.NoteKey || "(no key returned)"} to ${timelines.length} timeline(s)`)

  console.log("\n[208] DONE")
  console.log(`  Hub org:     ${orgId}`)
  console.log(`  Karbon org:  ${orgKarbonKey}  https://app2.karbonhq.com/4mTyp9lLRWTC#/organizations/${orgKarbonKey}`)
}

main().catch((e) => { console.error("[208] ERROR:", e.message); process.exit(1) })
