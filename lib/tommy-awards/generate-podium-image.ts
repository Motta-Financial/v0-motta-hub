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

import { generateText, generateImage } from "ai"
import { put } from "@vercel/blob"
import { findHeroProfile, findHeroProfileBySlug } from "@/lib/motta-alliance/hero-profiles"
import { IMAGE_PROMPT_MODEL, IMAGE_GENERATION_MODEL } from "@/lib/ai/models"

/** Model used to compose the image prompt.
 *  Currently bound to `openai/gpt-5.5-pro` — OpenAI's flagship
 *  reasoning model (May 2026). The prompt determines 80% of final
 *  image quality and this is a once-a-week one-shot, so we lean into
 *  the strongest available reasoning model. To bump models firm-wide,
 *  edit `IMAGE_PROMPT_MODEL` in `lib/ai/models.ts` instead of this
 *  re-export. */
export const PODIUM_PROMPT_MODEL = IMAGE_PROMPT_MODEL

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
 */
export async function generatePodiumImage(opts: {
  weekLabel: string
  winners: PodiumImageWinner[]
}): Promise<PodiumImageResult | null> {
  if (opts.winners.length === 0) return null

  try {
    // ── Step 1 — resolve hero profiles for each winner ────────────
    // We pull each winner's hero profile so we can hand GPT-5 the
    // canonical comic-book PNG as a vision input. The model studies
    // the source art directly instead of relying on textual
    // descriptors that drift over time (e.g. forgetting that a
    // teammate is a woman, or omitting a signature prop).
    const heroDescriptors = opts.winners.map((w) => {
      const hero =
        findHeroProfileBySlug(w.heroSlug ?? undefined) ?? findHeroProfile(w.name)
      return {
        rank: w.rank,
        name: w.name,
        alias: hero?.alias ?? null,
        role: hero?.role ?? null,
        quote: hero?.quote ?? null,
        appearance: hero?.appearance ?? null,
        // Public Blob URL of the canonical hero profile PNG. Must be
        // an absolute https URL for the AI Gateway to fetch it as a
        // vision input. Relative paths (e.g. ALFRED's `/images/...`)
        // are filtered out below and fall through to the textual
        // `appearance` descriptor.
        imageUrl: hero?.imageUrl ?? null,
      }
    })

    // ── Step 2 — ask GPT-5 to LOOK AT each hero's profile image and
    //              author an image prompt grounded in what it sees ──
    //
    // Vision-grounded prompting — we hand GPT-5 the actual canonical
    // hero artwork for every winner whose profile image is hosted on
    // a fetchable URL, and ask it to study the art before drafting.
    // This eliminates the entire class of "text described it wrong"
    // bugs (mis-gendered teammates, missing signature props, generic
    // costume colours) because the model is now looking at the truth.
    //
    // For roster entries whose `imageUrl` is a project-relative path
    // (currently only ALFRED at `/images/alfred-logo.png`) we still
    // emit the textual `appearance` fallback so the model has SOMETHING
    // to anchor on — vision-when-possible, text-when-not.
    const visionHeroes = heroDescriptors.filter(
      (h) => h.imageUrl && /^https?:\/\//i.test(h.imageUrl),
    )
    const textOnlyHeroes = heroDescriptors.filter(
      (h) => !h.imageUrl || !/^https?:\/\//i.test(h.imageUrl),
    )

    // Build the multimodal user message: one text block setting the
    // task, followed by one image block PER hero (with a text label
    // immediately before it so GPT-5 can correlate image-to-winner).
    // The AI SDK 6 message format accepts mixed `text` + `image` parts
    // in a single user message — the gateway routes images via OpenAI's
    // multimodal endpoint automatically when the bound model supports
    // vision (gpt-5.5-pro does).
    const userContent: Array<
      { type: "text"; text: string } | { type: "image"; image: URL | string }
    > = [
      {
        type: "text",
        text: `You are the art director for the Motta Financial Alliance comic book series. I will show you the CANONICAL hero profile artwork for each of this week's Tommy Awards winners. STUDY each image carefully — note apparent gender, body type, hair length/colour, skin tone, costume accents, mask/visor/hood design, signature props, and pose energy. Then compose a SINGLE image generation prompt (no preamble, no markdown, no quotation marks) describing a cinematic, comic-book-style illustration of an F1-style podium celebration for these winners, drawn in the same Motta Alliance art style as the source images.

Mandatory visual direction (do not deviate):
- Comic-book rendering matching the Motta Alliance series: dark background, dramatic moody lighting, faint city skyline at night, olive-green and gold accents, white lotus emblem on each hero's chest, halftone shading, bold inked outlines.
- An F1-style three-tier podium centre-frame: tallest centre (1st), shorter left (2nd), shortest right (3rd). Each tier has the rank number in large stencil typography.
- Heroes are stylised, not real-likeness portraits — but every hero's apparent gender, hair, costume accents and signature props MUST match the source artwork you just studied. If a winner is a woman in the source art, she MUST be drawn as a woman in the podium scene.
- Each hero holds a champagne bottle spraying olive-tinted "Motta Mist".
- Banner across the top reads exactly: MOTTA ALLIANCE — TOMMY AWARDS, with the week label "${opts.weekLabel}" immediately below it. Both lines must fit fully inside the canvas with at least 8% margin on the left and right edges — do NOT crop the banner.
- TEXT POLICY: The ONLY text in the image is the banner + week label + the three rank numerals (1, 2, 3) on the podium tiers. Do NOT bake hero names, role taglines, quotes, or any other captions into the artwork — those are rendered separately in the dashboard UI underneath the image.
- Color palette strictly: deep charcoal, jet black, olive green (#7a8a3a), gold (#d4af37), cream/off-white. NO purple. NO pastel pink.
- Style cue: same illustrator energy as a Marvel hero profile card crossed with an F1 victory poster.

Winners this week (images follow below, in podium order):`,
      },
    ]

    for (const h of visionHeroes) {
      userContent.push({
        type: "text",
        text: `\n${ordinal(h.rank)} place — ${h.alias ? `${h.alias} (${h.name})` : h.name}${h.role ? `, role: ${h.role}` : ""}. The canonical hero profile artwork is shown below — study it and ensure your prompt preserves the apparent gender, hair, costume design, and any signature props or holographic motifs visible in this image.`,
      })
      userContent.push({ type: "image", image: h.imageUrl as string })
    }

    if (textOnlyHeroes.length > 0) {
      userContent.push({
        type: "text",
        text: `\nAdditional winners (no source image available — render strictly per the description):\n${textOnlyHeroes
          .map(
            (h) =>
              `- ${ordinal(h.rank)} (${h.alias ? `${h.alias}, ${h.name}` : h.name})${h.role ? ` — role: ${h.role}` : ""}\n    APPEARANCE: ${h.appearance ?? "Stylised heroic figure in black tactical suit with white lotus chest emblem, olive trim."}`,
          )
          .join("\n")}`,
      })
    }

    userContent.push({
      type: "text",
      text: `\nReturn ONLY the final image prompt as a single paragraph of ≤ 280 words. No preamble. No markdown. The prompt must explicitly mention each winner by alias and place on the podium, and must lock in their apparent gender + a signature prop drawn directly from the source artwork you studied above.`,
    })

    // gpt-5.5-pro is a deep-reasoning model — it spends a large share
    // of its output budget on hidden reasoning tokens BEFORE emitting
    // any visible text. Vision inputs increase reasoning load further,
    // so we keep the output budget generous (8k tokens). Image-prompt
    // drafting is a once-a-week job so cost is negligible.
    let cleanedPrompt = ""
    try {
      const { text: imagePrompt } = await generateText({
        model: PODIUM_PROMPT_MODEL,
        messages: [{ role: "user", content: userContent }],
        maxOutputTokens: 8000,
      })
      cleanedPrompt = imagePrompt.trim().replace(/^["']|["']$/g, "")
      console.log(
        `[v0] tommy podium image: vision-grounded prompt drafted from ${visionHeroes.length} hero image(s)`,
      )
    } catch (promptErr) {
      console.warn("[v0] tommy podium image: prompt draft errored:", promptErr)
    }

    // Deterministic fallback — if GPT-5 returns empty (reasoning budget
    // exhausted, rate-limited, transient gateway issue, image fetch
    // failure) we still hand gpt-image-1 a well-formed Alliance-themed
    // prompt so the email/dashboard isn't broken. The fallback uses the
    // textual `appearance` descriptors as the only available signal.
    if (!cleanedPrompt) {
      console.warn("[v0] tommy podium image: empty prompt from GPT-5, using deterministic fallback")
      const winnersBlock = heroDescriptors
        .map(
          (h) =>
            `${ordinal(h.rank)} place — ${h.alias ? `${h.alias} (${h.name})` : h.name}${h.role ? `, role: ${h.role}` : ""}. ${h.appearance ?? "Stylised heroic figure in black tactical suit with white lotus chest emblem, olive trim."}`,
        )
        .join(" ")
      cleanedPrompt = `Cinematic comic-book illustration of an F1-style three-tier podium celebrating this week's Motta Financial Alliance Tommy Awards winners. Tallest centre tier for 1st, left tier for 2nd, right tier for 3rd, each with a large stencil rank number. Each hero holds a champagne bottle spraying olive-tinted "Motta Mist". Apparent gender and signature props for each winner are MANDATORY: ${winnersBlock} A banner across the top reads exactly "MOTTA ALLIANCE — TOMMY AWARDS" with "${opts.weekLabel}" beneath it; both banner lines must sit fully within the canvas with at least 8% margin on the left and right edges — do not crop the banner. The ONLY text in the image is that banner plus the rank numerals 1, 2, 3 on the podium tiers — do NOT bake hero names, taglines or quotes into the artwork. Dark moody background with a faint nighttime city skyline, dramatic rim lighting, bold inked outlines, halftone shading. Strict palette: deep charcoal, jet black, olive green (#7a8a3a), gold (#d4af37), cream/off-white. No purple, no pastel pink. Style: Marvel hero profile card crossed with an F1 victory poster. Stylised heroic figures only — NOT real-likeness portraits — but female heroes must be drawn as women and male heroes as men, per the descriptions above.`
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
