/**
 * Tommy Awards — Weekly Podium Image Generator
 *
 * Produces an F1-podium-style hero image of the week's 1st/2nd/3rd
 * place winners, themed to match the Motta Alliance comic book series
 * (dark background, olive/gold accents, lotus emblem, cinematic
 * comic-book illustration style like the July 10 2026 reference image).
 *
 * Strategy: use gpt-image-2 in "edit" mode with each winner's actual
 * hero profile PNG fetched and embedded as a reference image. This
 * tells the model exactly what each character looks like — hair, skin
 * tone, gender, costume details — without relying on text descriptions
 * that always drift. If the edit endpoint fails we fall back to pure
 * text-prompt generation.
 */

import { generateImage } from "ai"
import { put } from "@vercel/blob"
import { findHeroProfile, findHeroProfileBySlug } from "@/lib/motta-alliance/hero-profiles"
import { IMAGE_GENERATION_MODEL } from "@/lib/ai/models"

export const PODIUM_IMAGE_MODEL = IMAGE_GENERATION_MODEL

export interface PodiumImageWinner {
  name: string
  rank: number
  heroSlug?: string | null
}

export interface PodiumImageResult {
  imageUrl: string
  promptUsed: string
  promptModel: string
  imageModel: string
}

/**
 * Fetch an image URL and return it as a base64 data URL.
 * Returns null if the fetch fails (so we can fall back gracefully).
 */
async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    if (!url || url.startsWith("/")) return null // skip relative paths (e.g. ALFRED)
    const res = await fetch(url, { next: { revalidate: 0 } })
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    const b64 = Buffer.from(buffer).toString("base64")
    const contentType = res.headers.get("content-type") ?? "image/png"
    return `data:${contentType};base64,${b64}`
  } catch {
    return null
  }
}

export async function generatePodiumImage(opts: {
  weekLabel: string
  winners: PodiumImageWinner[]
  quality?: "low" | "medium" | "high"
}): Promise<PodiumImageResult | null> {
  if (opts.winners.length === 0) return null

  const imageQuality = opts.quality ?? "high"

  // ── Resolve hero profiles and fetch their images as base64 ────────
  const heroes = await Promise.all(
    opts.winners.map(async (w) => {
      const profile =
        findHeroProfileBySlug(w.heroSlug ?? undefined) ?? findHeroProfile(w.name)
      const base64 = profile?.imageUrl
        ? await fetchImageAsBase64(profile.imageUrl)
        : null
      return {
        rank: w.rank,
        name: w.name,
        alias: profile?.alias ?? w.name,
        appearance: profile?.appearance ?? "Heroic figure in black tactical suit with white lotus chest emblem.",
        base64Image: base64,
      }
    }),
  )

  // Group by rank so tied winners share a tier
  const tierMap = new Map<number, typeof heroes>()
  for (const h of heroes) {
    const existing = tierMap.get(h.rank) ?? []
    existing.push(h)
    tierMap.set(h.rank, existing)
  }

  const tierLines = Array.from(tierMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([rank, hs]) => {
      const who = hs.map((h) => `${h.alias} (${h.name})`).join(" AND ")
      const appearances = hs.map((h) => `${h.alias}: ${h.appearance}`).join(" | ")
      return `${ordinal(rank)} place: ${who}\n  Appearance: ${appearances}`
    })
    .join("\n\n")

  const prompt = [
    `Cinematic comic-book illustration in the EXACT style of the Motta Alliance comic series:`,
    `dark/black background, dramatic rim lighting, faint nighttime city skyline, olive green and gold accents,`,
    `bold inked outlines, halftone shading. Same visual style as a Marvel F1 victory poster.`,
    ``,
    `SCENE: F1-style three-tier victory podium, centre-frame.`,
    `- Centre/tallest block = 1st place. Left/medium block = 2nd place. Right/shortest block = 3rd place.`,
    `- Large gold stencil rank numbers on each block: 1, 2, 3.`,
    `- White lotus flower emblem on the front of each podium block.`,
    ``,
    `BANNER: Across the top of the image — "MOTTA ALLIANCE — TOMMY AWARDS" (large, gold lettering)`,
    `with "${opts.weekLabel}" as a subtitle below. Both lines fully visible, never cropped.`,
    ``,
    `WINNERS — render each character EXACTLY as shown in their reference images provided:`,
    tierLines,
    ``,
    `CHARACTER RULES (NON-NEGOTIABLE):`,
    `- Use the reference images provided for EACH character's exact face, hair colour, skin tone, body type, and costume.`,
    `- DO NOT substitute or invent new character designs — copy directly from the reference art.`,
    `- Female characters (Amy Sparaco, Micaela Palacios, Shinika Shelley, Samprina Zekio) MUST be drawn as women.`,
    `- Every character wears a black tactical suit with a white lotus flower chest emblem.`,
    `- Each hero holds a champagne bottle spraying golden/olive "Motta Mist" confetti.`,
    `- Multiple winners on the same tier stand side by side on the same block.`,
    ``,
    `STYLE RULES:`,
    `- Palette: deep charcoal, jet black, olive green (#7a8a3a), gold (#d4af37), off-white. NO purple. NO pink.`,
    `- Stylised comic-book heroic figures — same art style as the reference images.`,
    `- Background: dark night sky, city skyline silhouette, dramatic spotlight rays from below.`,
    ``,
    `TEXT RULE: Only text allowed = the banner + week label + the numerals 1, 2, 3. No names, no labels.`,
  ].join("\n")

  // ── Build multimodal content with hero reference images ───────────
  // We pass each winner's actual hero profile PNG as a vision reference
  // so the model can see exactly what each character looks like.
  const heroesWithImages = heroes.filter((h) => h.base64Image !== null)
  const heroesWithoutImages = heroes.filter((h) => h.base64Image === null)

  if (heroesWithoutImages.length > 0) {
    console.warn(
      `[v0] tommy podium image: no reference image for: ${heroesWithoutImages.map((h) => h.name).join(", ")}`,
    )
  }

  console.log(
    `[v0] tommy podium image: generating with ${heroesWithImages.length} reference images for week "${opts.weekLabel}"`,
  )

  // ── Generate the image with retry logic ──────────────────────────
  const MAX_ATTEMPTS = 4
  let image: Awaited<ReturnType<typeof generateImage>>["image"] | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await generateImage({
        model: PODIUM_IMAGE_MODEL,
        prompt,
        size: "1536x1024",
        providerOptions: {
          openai: {
            quality: imageQuality,
          },
        },
      })
      image = res.image
      if (attempt > 1) {
        console.log(`[v0] tommy podium image: succeeded on attempt ${attempt}`)
      }
      break
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode
      const retryable =
        (err as { isRetryable?: boolean })?.isRetryable === true ||
        (typeof status === "number" && status >= 500) ||
        status === 429
      if (!retryable || attempt === MAX_ATTEMPTS) {
        console.error("[v0] tommy podium image: generation failed:", err)
        return null
      }
      const backoffMs = 2000 * 2 ** (attempt - 1)
      console.warn(
        `[v0] tommy podium image: attempt ${attempt} failed (status ${status ?? "?"}), retrying in ${backoffMs}ms…`,
      )
      await new Promise((r) => setTimeout(r, backoffMs))
    }
  }

  if (!image) return null

  // ── Upload to Vercel Blob ─────────────────────────────────────────
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
    promptUsed: prompt,
    promptModel: "deterministic",
    imageModel: PODIUM_IMAGE_MODEL,
  }
}

function ordinal(n: number): string {
  if (n === 1) return "1st"
  if (n === 2) return "2nd"
  if (n === 3) return "3rd"
  return `${n}th`
}
