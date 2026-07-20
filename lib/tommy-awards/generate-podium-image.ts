/**
 * Tommy Awards — Weekly Podium Image Generator
 *
 * Produces an F1-podium-style hero image of the week's 1st/2nd/3rd
 * place winners, themed to match the Motta Alliance comic book series
 * (dark background, olive/gold accents, lotus emblem, cinematic
 * comic-book illustration). The result is uploaded to Vercel Blob and
 * the public URL is returned so the cron can embed it in the recap
 * email and persist it in `tommy_weekly_recaps`.
 *
 * Two-step pipeline:
 *   1. GPT-5 ("the latest ChatGPT") drafts a tightly scoped image
 *      prompt. CRITICALLY, the prompt drafter is given each winner's
 *      hero profile PNG as a vision input — it actually LOOKS at the
 *      canonical comic-book artwork for each winner and grounds the
 *      generated description in what it sees (apparent gender, hair,
 *      costume colour, mask/cowl design, signature props). Earlier
 *      iterations passed only textual descriptions, which led to
 *      drift (e.g. four generic male superheroes when two of the
 *      winners were women). Letting the model see the source art is
 *      the cure for that drift.
 *   2. gpt-image-1 ("the latest image generation tool") renders the
 *      image at HIGH quality (the "extended pro" tier OpenAI exposes
 *      for that model).
 *
 * If either step fails the helper resolves to `null` — the caller
 * (the cron route) treats this as a soft failure and still sends the
 * email, just without the hero image.
 */

import { generateImage } from "ai"
import { put } from "@vercel/blob"
import { findHeroProfile, findHeroProfileBySlug } from "@/lib/motta-alliance/hero-profiles"
import { IMAGE_GENERATION_MODEL } from "@/lib/ai/models"
import { composePodiumImage } from "@/lib/tommy-awards/compose-podium-image"

/** Image model — currently bound to `openai/gpt-image-2`, OpenAI's
 *  latest image generator (May 2026). Same `quality` provider option
 *  as the previous gpt-image-1 tier; `"high"` is the slowest + best
 *  output the model exposes. */
export const PODIUM_IMAGE_MODEL = IMAGE_GENERATION_MODEL

export interface PodiumImageWinner {
  name: string
  rank: number
  /** Optional hero profile slug from team_members.hero_profile_slug. */
  heroSlug?: string | null
}

export interface PodiumImageResult {
  imageUrl: string
  promptUsed: string
  promptModel: string
  imageModel: string
}

/**
 * Generate + upload the weekly podium image. Returns `null` on failure
 * so the cron can fall back to an image-less email gracefully.
 *
 * @param opts.quality - "high" (default, best quality, used by cron) or
 *   "medium" (faster, used by manual admin regeneration to stay within
 *   serverless background task time limits).
 */
export async function generatePodiumImage(opts: {
  weekLabel: string
  winners: PodiumImageWinner[]
  quality?: "low" | "medium" | "high"
}): Promise<PodiumImageResult | null> {
  if (opts.winners.length === 0) return null

  // ── Primary path: compositor (real hero PNGs, no AI hallucination) ──
  // Fetch the actual hero profile images from Blob and composite them
  // directly onto the podium layout. This guarantees pixel-perfect
  // character fidelity — no text descriptions, no AI-drawn faces.
  const compositorResult = await composePodiumImage({
    weekLabel: opts.weekLabel,
    winners: opts.winners,
  })
  if (compositorResult) {
    return {
      imageUrl: compositorResult.imageUrl,
      promptUsed: "compositor — real hero PNGs composited directly",
      promptModel: "compositor",
      imageModel: "compositor",
    }
  }

  // ── Fallback: AI image generation (if compositor fails) ─────────
  console.warn("[v0] tommy podium image: compositor failed, falling back to AI generation")

  // Default to "high" for the Friday cron; admin manual regenerations
  // pass "medium" so the job finishes well within background task limits.
  const imageQuality = opts.quality ?? "high"

  try {
    // ── Step 1 — resolve hero profiles for each winner ────────────
    // We use the pre-written `appearance` descriptors from hero-profiles.ts.
    // These are precise, purpose-built strings (gender, hair, skin tone,
    // costume, signature props) written specifically for this pipeline.
    // Passing 5 large PNG images to a vision model proved unreliable —
    // the model either timed out, ignored the images, or averaged the
    // visual inputs into generic-looking heroes. Text descriptors are
    // faster, deterministic, and produce better character fidelity
    // because the image model follows explicit text instructions precisely.
    const heroDescriptors = opts.winners.map((w) => {
      const hero =
        findHeroProfileBySlug(w.heroSlug ?? undefined) ?? findHeroProfile(w.name)
      return {
        rank: w.rank,
        name: w.name,
        alias: hero?.alias ?? null,
        role: hero?.role ?? null,
        appearance: hero?.appearance ??
          "Stylised heroic figure in black tactical suit with white lotus chest emblem, olive trim.",
      }
    })

    // ── Step 2 — build the image prompt directly from appearance descriptors ──
    // We no longer use GPT-5 as an intermediary. Instead we compose the
    // prompt deterministically from the hero profiles. This eliminates:
    //   - The 30–60s GPT-5 reasoning latency
    //   - Vision-input context overload from 5 large PNGs
    //   - Non-determinism (the model sometimes drifts or ignores images)
    // The prompt is structured so the image model receives each character's
    // gender, hair, costume, and signature props as a direct, explicit
    // instruction — not something it has to infer from a photo.

    // Group by podium tier so tied ranks share a tier description
    const tierMap = new Map<number, typeof heroDescriptors>()
    for (const h of heroDescriptors) {
      const existing = tierMap.get(h.rank) ?? []
      existing.push(h)
      tierMap.set(h.rank, existing)
    }

    const tierDescriptions = Array.from(tierMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([rank, heroes]) => {
        const label = ordinal(rank)
        const heroParts = heroes.map((h) => {
          const who = h.alias ? `${h.alias} (${h.name})` : h.name
          return `${who}: ${h.appearance}`
        })
        return `${label} place podium tier: ${heroParts.join(" AND ")}`
      })
      .join("\n\n")

    const cleanedPrompt = [
      `Cinematic comic-book illustration of an F1-style three-tier victory podium celebrating this week's Motta Financial Alliance Tommy Awards, titled "MOTTA ALLIANCE — TOMMY AWARDS" with the subtitle "${opts.weekLabel}". Banner spans the full top edge of the image with at least 8% margin on each side — do NOT crop it.`,
      ``,
      `PODIUM LAYOUT: Three-tier F1 podium centre-frame. Centre/tallest tier = 1st place. Left/medium tier = 2nd place. Right/shortest tier = 3rd place. Each tier has its rank number in large gold stencil: 1, 2, 3.`,
      ``,
      `CHARACTER DESCRIPTIONS — render EXACTLY as described. Every detail (gender, hair, skin tone, suit accents, props) is MANDATORY:`,
      ``,
      tierDescriptions,
      ``,
      `SHARED VISUAL RULES:`,
      `- Every character wears a black tactical suit with a white lotus flower chest emblem.`,
      `- Each hero holds a champagne bottle spraying olive-tinted "Motta Mist" confetti.`,
      `- If a character description says WOMAN or feminine — draw her as a woman, always.`,
      `- If a character description says man — draw him as a man, always.`,
      `- When multiple heroes share a tier, show both standing together on that same podium block.`,
      ``,
      `STYLE: Dark moody background with faint nighttime city skyline, dramatic rim lighting, bold inked outlines, halftone shading. Strict palette: deep charcoal, jet black, olive green (#7a8a3a), gold (#d4af37), cream/off-white. NO purple, NO pastel pink. Style: Marvel hero profile card crossed with an F1 victory poster. Stylised heroic comic-book figures — NOT photorealistic portraits.`,
      ``,
      `TEXT POLICY: The ONLY text in the image is the "MOTTA ALLIANCE — TOMMY AWARDS" banner, the "${opts.weekLabel}" subtitle, and the rank numerals 1, 2, 3 on the podium tiers. Do NOT add hero names, taglines, role labels, or any other captions.`,
    ].join("\n")

    console.log("[v0] tommy podium image: prompt built from appearance descriptors, generating image…")

    // ── Step 3 — render the image at HIGH ("extended pro") quality ──
    // gpt-image-2 intermittently returns transient 5xx ("Internal Server
    // Error", isRetryable: true) under load. A single failure used to sink
    // the entire weekly render, which is why the Tommy email kept shipping
    // without art. Retry a few times with exponential backoff before giving
    // up; only retry on transient/5xx errors so we fail fast on real
    // problems (bad prompt, auth, content policy).
    const MAX_IMAGE_ATTEMPTS = 4
    let image: Awaited<ReturnType<typeof generateImage>>["image"] | null = null
    for (let attempt = 1; attempt <= MAX_IMAGE_ATTEMPTS; attempt++) {
      try {
        const res = await generateImage({
          model: PODIUM_IMAGE_MODEL,
          prompt: cleanedPrompt,
          size: "1536x1024", // wide format suits the F1 podium composition
          providerOptions: {
            openai: {
              // "high" = best quality (used by the Friday cron).
              // "medium" = faster, used for manual admin regenerations
              // to stay within serverless background task time limits.
              quality: imageQuality,
            },
          },
        })
        image = res.image
        if (attempt > 1) {
          console.log(`[v0] tommy podium image: render succeeded on attempt ${attempt}`)
        }
        break
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode
        const retryable =
          (err as { isRetryable?: boolean })?.isRetryable === true ||
          (typeof status === "number" && status >= 500) ||
          status === 429
        if (!retryable || attempt === MAX_IMAGE_ATTEMPTS) {
          throw err
        }
        const backoffMs = 2000 * 2 ** (attempt - 1) // 2s, 4s, 8s
        console.warn(
          `[v0] tommy podium image: render attempt ${attempt} failed (status ${status ?? "?"}), retrying in ${backoffMs}ms…`,
        )
        await new Promise((r) => setTimeout(r, backoffMs))
      }
    }

    if (!image) {
      throw new Error("image generation returned no image after retries")
    }

    // ── Step 4 — upload to Vercel Blob for email embedding ───────
    // image.uint8Array is the raw PNG; we wrap it in a Buffer so the
    // @vercel/blob SDK can stream it.
    const buffer = Buffer.from(image.uint8Array)
    const slug = opts.weekLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
    const pathname = `tommy-awards/podiums/${slug}-${Date.now()}.png`

    const blob = await put(pathname, buffer, {
      access: "public",
      contentType: "image/png",
      addRandomSuffix: false,
    })

    return {
      imageUrl: blob.url,
      promptUsed: cleanedPrompt,
      promptModel: "deterministic",
      imageModel: PODIUM_IMAGE_MODEL,
    }
  } catch (err) {
    console.error("[v0] tommy podium image: generation failed:", err)
    return null
  }
}

function ordinal(n: number): string {
  if (n === 1) return "1st"
  if (n === 2) return "2nd"
  if (n === 3) return "3rd"
  return `${n}th`
}
