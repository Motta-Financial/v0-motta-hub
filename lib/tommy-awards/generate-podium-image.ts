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
 *      prompt that references each winner's hero profile (alias,
 *      role, visual cues) so the generated image actually matches the
 *      Alliance art direction instead of producing generic stock art.
 *   2. gpt-image-1 ("the latest image generation tool") renders the
 *      image at HIGH quality (the "extended pro" tier OpenAI exposes
 *      for that model).
 *
 * If either step fails the helper resolves to `null` — the caller
 * (the cron route) treats this as a soft failure and still sends the
 * email, just without the hero image.
 */

import { generateText, generateImage } from "ai"
import { put } from "@vercel/blob"
import { findHeroProfile, findHeroProfileBySlug } from "@/lib/motta-alliance/hero-profiles"
import { OPENAI_GPT_5 } from "@/lib/ai/models"

/** Model used to compose the image prompt. */
export const PODIUM_PROMPT_MODEL = OPENAI_GPT_5

/** Image model — OpenAI's flagship image generator, via the AI Gateway. */
export const PODIUM_IMAGE_MODEL = "openai/gpt-image-1" as const

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
 */
export async function generatePodiumImage(opts: {
  weekLabel: string
  winners: PodiumImageWinner[]
}): Promise<PodiumImageResult | null> {
  if (opts.winners.length === 0) return null

  try {
    // ── Step 1 — resolve hero profiles for each winner ────────────
    // We pass the comic-book hero descriptors into the image prompt
    // so the generated art looks like the rest of the Motta Alliance
    // universe (same olive/black palette, lotus emblems, cinematic
    // comic-book rendering) rather than generic finance stock art.
    const heroDescriptors = opts.winners.map((w) => {
      const hero =
        findHeroProfileBySlug(w.heroSlug ?? undefined) ?? findHeroProfile(w.name)
      return {
        rank: w.rank,
        name: w.name,
        alias: hero?.alias ?? null,
        role: hero?.role ?? null,
        quote: hero?.quote ?? null,
      }
    })

    // ── Step 2 — ask GPT-5 to author the image prompt ────────────
    const promptDraftInstruction = `You are the art director for the Motta Financial Alliance comic book series. Compose a SINGLE image generation prompt (no preamble, no markdown, no quotation marks) describing a cinematic, comic-book-style illustration of an F1-style podium celebration for this week's Tommy Awards winners.

Mandatory visual direction (do not deviate):
- Comic-book rendering matching the Motta Alliance series: dark background, dramatic moody lighting, faint city skyline at night, olive-green and gold accents, white lotus emblem on each hero's chest, halftone shading, bold inked outlines.
- An F1-style three-tier podium center-frame: tallest center (1st), shorter left (2nd), shortest right (3rd). Each tier has the rank number in large stencil typography.
- Each hero is depicted in tactical/superhero attire consistent with the Motta Alliance universe (NOT real-likeness portraits — stylised heroic figures). Heroes hold a champagne bottle spraying olive-tinted "Motta Mist" instead of bubbly.
- Banner across the top reads "MOTTA ALLIANCE — TOMMY AWARDS" and the week label below it.
- Color palette strictly: deep charcoal, jet black, olive green (#7a8a3a), gold (#d4af37), cream/off-white. NO purple. NO pastel pink.
- Style cue: same illustrator energy as a Marvel hero profile card crossed with an F1 victory poster.

Winners this week (use their hero alias when one is provided — do NOT use real-likeness portraits):
${heroDescriptors
  .map(
    (h) =>
      `- ${ordinal(h.rank)}: ${h.alias ? `${h.alias} (${h.name})` : h.name}${h.role ? ` — role: ${h.role}` : ""}`,
  )
  .join("\n")}

Week label to display on the banner: "${opts.weekLabel}".

Return ONLY the final image prompt as a single paragraph of ≤ 220 words. Do not include any other commentary.`

    // GPT-5 is a reasoning model — it spends a significant chunk of
    // its output budget on hidden reasoning tokens BEFORE any visible
    // text emerges. 500 was empirically too tight: the model burned
    // the entire budget on reasoning and returned an empty string,
    // which caused the whole image pipeline to silently fail. 2_500
    // leaves comfortable headroom for reasoning + a ≤ 220-word prompt.
    let cleanedPrompt = ""
    try {
      const { text: imagePrompt } = await generateText({
        model: PODIUM_PROMPT_MODEL,
        prompt: promptDraftInstruction,
        maxOutputTokens: 2500,
      })
      cleanedPrompt = imagePrompt.trim().replace(/^["']|["']$/g, "")
    } catch (promptErr) {
      console.warn("[v0] tommy podium image: prompt draft errored:", promptErr)
    }

    // Deterministic fallback — if GPT-5 returns empty (reasoning budget
    // exhausted, rate-limited, transient gateway issue, etc.) we still
    // hand gpt-image-1 a well-formed Alliance-themed prompt so the
    // image renders. The fallback intentionally mirrors the same visual
    // direction GPT-5 is asked to author so the result is on-brand.
    if (!cleanedPrompt) {
      console.warn("[v0] tommy podium image: empty prompt from GPT-5, using deterministic fallback")
      const winnersLine = heroDescriptors
        .map(
          (h) =>
            `${ordinal(h.rank)}: ${h.alias ? `${h.alias} (${h.name})` : h.name}${h.role ? ` — ${h.role}` : ""}`,
        )
        .join("; ")
      cleanedPrompt = `Cinematic comic-book illustration of an F1-style three-tier podium celebrating this week's Motta Financial Alliance Tommy Awards winners (${winnersLine}). Tallest center tier for 1st, left tier for 2nd, right tier for 3rd, each with a large stencil rank number. Stylised heroic figures in tactical superhero attire — NOT real-likeness portraits — each with a white lotus emblem on the chest, spraying olive-tinted "Motta Mist" from champagne bottles. A banner across the top reads "MOTTA ALLIANCE — TOMMY AWARDS" with "${opts.weekLabel}" beneath it. Dark moody background with a faint nighttime city skyline, dramatic rim lighting, bold inked outlines, halftone shading. Strict palette: deep charcoal, jet black, olive green (#7a8a3a), gold (#d4af37), cream/off-white. No purple, no pastel pink. Style: Marvel hero profile card crossed with an F1 victory poster.`
    }

    console.log("[v0] tommy podium image: prompt drafted, generating image…")

    // ── Step 3 — render the image at HIGH ("extended pro") quality ──
    const { image } = await generateImage({
      model: PODIUM_IMAGE_MODEL,
      prompt: cleanedPrompt,
      size: "1536x1024", // wide format suits the F1 podium composition
      providerOptions: {
        openai: {
          // gpt-image-1's top tier — the "extended pro" output the user
          // asked for. "low" / "medium" / "high" are the supported
          // values; "high" is the slowest + most detailed.
          quality: "high",
        },
      },
    })

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
      promptModel: PODIUM_PROMPT_MODEL,
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
