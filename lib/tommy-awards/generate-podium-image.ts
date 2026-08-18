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
 * Groups winners by rank so ties (two+ people sharing 1st/2nd/3rd) can
 * be called out explicitly to the prompt-drafting model. Without this,
 * the model has no signal that two winners belong on the SAME podium
 * tier and tends to either drop one of them or spread them across
 * separate tiers.
 */
function groupByRank<T extends { rank: number }>(winners: T[]): Map<number, T[]> {
  const byRank = new Map<number, T[]>()
  for (const w of winners) {
    const list = byRank.get(w.rank) ?? []
    list.push(w)
    byRank.set(w.rank, list)
  }
  return byRank
}

/**
 * Generate + upload the weekly podium image. Returns `null` on failure
 * so the cron can fall back to an image-less email gracefully.
 *
 * `customPrompt`, when provided, is used VERBATIM for the image render
 * step — the GPT-5.5-pro vision-grounded drafting step (step 1-2 below)
 * is skipped entirely. This is how the admin "regenerate with a custom
 * prompt" tool works: an operator can hand-edit or fully replace the
 * prompt after a bad render (e.g. the podium showing extra people who
 * aren't winners) without waiting on the drafting model again.
 */
export async function generatePodiumImage(opts: {
  weekLabel: string
  winners: PodiumImageWinner[]
  customPrompt?: string | null
}): Promise<PodiumImageResult | null> {
  if (opts.winners.length === 0) return null

  // ── Custom-prompt short-circuit ──────────────────────────────────
  // Skip the drafting model entirely and render the operator-supplied
  // prompt directly. Still goes through the same retrying render +
  // upload pipeline below.
  const trimmedCustomPrompt = opts.customPrompt?.trim()
  if (trimmedCustomPrompt) {
    console.log("[v0] tommy podium image: using custom prompt, skipping drafting step")
    const image = await renderPodiumImageWithRetry(trimmedCustomPrompt)
    if (!image) return null
    const imageUrl = await uploadPodiumImage(image, opts.weekLabel)
    if (!imageUrl) return null
    return {
      imageUrl,
      promptUsed: trimmedCustomPrompt,
      promptModel: "custom",
      imageModel: PODIUM_IMAGE_MODEL,
    }
  }

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

    // ── Cast count + tie grouping ─────────────────────────────────
    // Two bugs this section exists to prevent:
    //   1. The model treating the Motta Alliance as an ensemble cast
    //      and drawing extra teammates who aren't winners this week
    //      (e.g. rendering 7 heroes for a 3-winner week).
    //   2. Ties (two+ winners sharing the same rank) getting spread
    //      across separate podium tiers instead of standing together
    //      on the ONE tier they actually share.
    const totalWinnerCount = opts.winners.length
    const rankGroups = groupByRank(opts.winners)
    const tiedRankClauses = Array.from(rankGroups.entries())
      .filter(([, group]) => group.length > 1)
      .sort(([a], [b]) => a - b)
      .map(([rank, group]) => {
        const names = group
          .map((w) => {
            const hero = findHeroProfileBySlug(w.heroSlug ?? undefined) ?? findHeroProfile(w.name)
            return hero?.alias ? `${hero.alias} (${w.name})` : w.name
          })
          .join(" AND ")
        return `${ordinal(rank)} place is a TIE between ${group.length} co-winners: ${names}. They must stand TOGETHER on the SAME ${ordinal(rank)}-place podium tier, side by side, both/all holding or standing beside that tier's single rank numeral — do NOT give them separate tiers and do NOT split them apart.`
      })

    const castCountClause = `CAST COUNT — STRICT: there are EXACTLY ${totalWinnerCount} winner${totalWinnerCount === 1 ? "" : "s"} this week and the podium must show EXACTLY ${totalWinnerCount} ${totalWinnerCount === 1 ? "hero" : "heroes"} total, no more and no fewer. Do NOT add extra teammates, ensemble cast members, background heroes, robots, or filler characters to pad out the scene, even if the Motta Alliance is normally a larger team. Every single person visible in the image must be one of the named winners below.`

    const tieClause =
      tiedRankClauses.length > 0
        ? `TIES — STRICT: ${tiedRankClauses.join(" ")}`
        : `No ties this week — each of the ${totalWinnerCount} winners gets their own distinct podium tier per their rank.`

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
- ${castCountClause}
- ${tieClause}
- Comic-book rendering matching the Motta Alliance series: dark background, dramatic moody lighting, faint city skyline at night, olive-green and gold accents, white lotus emblem on each hero's chest, halftone shading, bold inked outlines.
- An F1-style three-tier podium centre-frame: tallest centre (1st), shorter left (2nd), shortest right (3rd). Each tier has the rank number in large stencil typography. If a tier has co-winners (a tie), both/all of them stand on that ONE tier together — never invent additional tiers or side platforms to fit them.
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
      text: `\nReturn ONLY the final image prompt as a single paragraph of ≤ 280 words. No preamble. No markdown. The prompt must explicitly mention each winner by alias and place on the podium, must lock in their apparent gender + a signature prop drawn directly from the source artwork you studied above, must restate the exact cast count (${totalWinnerCount} total, no extras) somewhere in the prompt, and — if any ranks are tied — must explicitly instruct that the tied winners share ONE tier together.`,
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
      cleanedPrompt = `Cinematic comic-book illustration of an F1-style three-tier podium celebrating this week's Motta Financial Alliance Tommy Awards winners. ${castCountClause} ${tieClause} Tallest centre tier for 1st, left tier for 2nd, right tier for 3rd, each with a large stencil rank number; tied ranks share their one tier together, side by side. Each hero holds a champagne bottle spraying olive-tinted "Motta Mist". Apparent gender and signature props for each winner are MANDATORY: ${winnersBlock} A banner across the top reads exactly "MOTTA ALLIANCE — TOMMY AWARDS" with "${opts.weekLabel}" beneath it; both banner lines must sit fully within the canvas with at least 8% margin on the left and right edges — do not crop the banner. The ONLY text in the image is that banner plus the rank numerals 1, 2, 3 on the podium tiers — do NOT bake hero names, taglines or quotes into the artwork. Dark moody background with a faint nighttime city skyline, dramatic rim lighting, bold inked outlines, halftone shading. Strict palette: deep charcoal, jet black, olive green (#7a8a3a), gold (#d4af37), cream/off-white. No purple, no pastel pink. Style: Marvel hero profile card crossed with an F1 victory poster. Stylised heroic figures only — NOT real-likeness portraits — but female heroes must be drawn as women and male heroes as men, per the descriptions above.`
    }

    console.log("[v0] tommy podium image: prompt drafted, generating image…")

    // ── Step 3 — render the image at HIGH ("extended pro") quality ──
    const image = await renderPodiumImageWithRetry(cleanedPrompt)
    if (!image) {
      throw new Error("image generation returned no image after retries")
    }

    // ── Step 4 — upload to Vercel Blob for email embedding ───────
    const imageUrl = await uploadPodiumImage(image, opts.weekLabel)
    if (!imageUrl) {
      throw new Error("image upload to Vercel Blob failed")
    }

    return {
      imageUrl,
      promptUsed: cleanedPrompt,
      promptModel: PODIUM_PROMPT_MODEL,
      imageModel: PODIUM_IMAGE_MODEL,
    }
  } catch (err) {
    console.error("[v0] tommy podium image: generation failed:", err)
    return null
  }
}

/**
 * Renders `prompt` with gpt-image-2 at HIGH ("extended pro") quality.
 * gpt-image-2 intermittently returns transient 5xx ("Internal Server
 * Error", isRetryable: true) under load. A single failure used to sink
 * the entire weekly render, which is why the Tommy email kept shipping
 * without art. Retry a few times with exponential backoff before giving
 * up; only retry on transient/5xx errors so we fail fast on real
 * problems (bad prompt, auth, content policy). Shared by both the
 * vision-drafted pipeline and the custom-prompt short-circuit.
 */
async function renderPodiumImageWithRetry(
  prompt: string,
): Promise<Awaited<ReturnType<typeof generateImage>>["image"] | null> {
  const MAX_IMAGE_ATTEMPTS = 4
  for (let attempt = 1; attempt <= MAX_IMAGE_ATTEMPTS; attempt++) {
    try {
      const res = await generateImage({
        model: PODIUM_IMAGE_MODEL,
        prompt,
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
      if (attempt > 1) {
        console.log(`[v0] tommy podium image: render succeeded on attempt ${attempt}`)
      }
      return res.image
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode
      const retryable =
        (err as { isRetryable?: boolean })?.isRetryable === true ||
        (typeof status === "number" && status >= 500) ||
        status === 429
      if (!retryable || attempt === MAX_IMAGE_ATTEMPTS) {
        console.error("[v0] tommy podium image: render failed:", err)
        return null
      }
      const backoffMs = 2000 * 2 ** (attempt - 1) // 2s, 4s, 8s
      console.warn(
        `[v0] tommy podium image: render attempt ${attempt} failed (status ${status ?? "?"}), retrying in ${backoffMs}ms…`,
      )
      await new Promise((r) => setTimeout(r, backoffMs))
    }
  }
  return null
}

/**
 * Uploads a rendered podium image to Vercel Blob and returns the
 * public URL, or `null` on failure. Shared by both the vision-drafted
 * pipeline and the custom-prompt short-circuit.
 */
async function uploadPodiumImage(
  image: NonNullable<Awaited<ReturnType<typeof generateImage>>["image"]>,
  weekLabel: string,
): Promise<string | null> {
  try {
    // image.uint8Array is the raw PNG; we wrap it in a Buffer so the
    // @vercel/blob SDK can stream it.
    const buffer = Buffer.from(image.uint8Array)
    const slug = weekLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
    const pathname = `tommy-awards/podiums/${slug}-${Date.now()}.png`

    const blob = await put(pathname, buffer, {
      access: "public",
      contentType: "image/png",
      addRandomSuffix: false,
    })
    return blob.url
  } catch (err) {
    console.error("[v0] tommy podium image: upload failed:", err)
    return null
  }
}

function ordinal(n: number): string {
  if (n === 1) return "1st"
  if (n === 2) return "2nd"
  if (n === 3) return "3rd"
  return `${n}th`
}
