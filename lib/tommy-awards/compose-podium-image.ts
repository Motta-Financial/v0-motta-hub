/**
 * Tommy Awards — Podium Image Compositor
 *
 * Builds the weekly podium image by compositing the ACTUAL hero profile
 * PNGs from Vercel Blob directly onto an F1-style podium layout.
 *
 * No AI image generation is involved — we fetch each winner's canonical
 * hero PNG and place it at the correct podium position using @vercel/og
 * (Satori). This guarantees pixel-perfect character fidelity: Amy will
 * always have her exact hair colour, Caleb his exact costume, etc.
 *
 * Layout (1536 × 864):
 *   - Dark charcoal background with subtle city-skyline tint
 *   - "MOTTA ALLIANCE — TOMMY AWARDS" banner at the top
 *   - Three podium tiers centre-frame: 1st (tallest, centre), 2nd (left),
 *     3rd (right). Tiers that have 2 winners show both hero images side
 *     by side on that block.
 *   - Each hero PNG is rendered at full height above their tier block,
 *     preserving the source aspect ratio
 *   - Gold tier numbers (1 / 2 / 3) stencilled on each block
 *   - Lotus emblem decorates the 1st-place block
 */

import { ImageResponse } from "@vercel/og"
import { put } from "@vercel/blob"
import {
  findHeroProfile,
  findHeroProfileBySlug,
  type HeroProfile,
} from "@/lib/motta-alliance/hero-profiles"

export interface PodiumCompositorWinner {
  name: string
  rank: number
  heroSlug?: string | null
}

export interface PodiumCompositorResult {
  imageUrl: string
  method: "compositor"
}

const WIDTH = 1536
const HEIGHT = 864

// Podium tier heights (px from bottom of the podium platform area)
const TIER_HEIGHTS = { 1: 140, 2: 100, 3: 70 } as const

// Hero image display heights
const HERO_HEIGHT = { 1: 420, 2: 380, 3: 340 } as const

// Fetch an image URL and return it as a base64 data URL so Satori can
// render it without needing a live network call during rendering.
async function fetchAsDataUrl(url: string): Promise<string | null> {
  if (!url || url.startsWith("/")) return null // skip relative paths (e.g. ALFRED)
  try {
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const b64 = Buffer.from(buf).toString("base64")
    const ct = res.headers.get("content-type") ?? "image/png"
    return `data:${ct};base64,${b64}`
  } catch {
    return null
  }
}

// Resolve hero profile → fetch image as data URL
async function resolveHero(
  name: string,
  heroSlug?: string | null,
): Promise<{ profile: HeroProfile | null; dataUrl: string | null }> {
  const profile =
    findHeroProfileBySlug(heroSlug ?? undefined) ?? findHeroProfile(name)
  if (!profile) return { profile: null, dataUrl: null }
  const dataUrl = await fetchAsDataUrl(profile.imageUrl)
  return { profile, dataUrl }
}

type TierData = {
  rank: 1 | 2 | 3
  winners: Array<{ name: string; alias: string | null; dataUrl: string | null }>
}

export async function composePodiumImage(opts: {
  weekLabel: string
  winners: PodiumCompositorWinner[]
}): Promise<PodiumCompositorResult | null> {
  if (opts.winners.length === 0) return null

  try {
    // ── 1. Fetch all hero images in parallel ─────────────────────
    const resolved = await Promise.all(
      opts.winners.map((w) => resolveHero(w.name, w.heroSlug).then((r) => ({ ...w, ...r }))),
    )

    // ── 2. Group by podium tier ───────────────────────────────────
    const tierMap = new Map<number, TierData>()
    for (const w of resolved) {
      const rank = Math.min(w.rank, 3) as 1 | 2 | 3 // clamp to 1/2/3
      if (!tierMap.has(rank)) {
        tierMap.set(rank, { rank, winners: [] })
      }
      tierMap.get(rank)!.winners.push({
        name: w.name,
        alias: w.profile?.alias ?? null,
        dataUrl: w.dataUrl,
      })
    }

    const tier1 = tierMap.get(1) ?? { rank: 1 as const, winners: [] }
    const tier2 = tierMap.get(2) ?? { rank: 2 as const, winners: [] }
    const tier3 = tierMap.get(3) ?? { rank: 3 as const, winners: [] }

    // ── 3. Render with Satori ────────────────────────────────────
    // We use inline styles only (Satori's subset of CSS).
    const heroImages = (
      tier: TierData,
      heroHeight: number,
    ): React.ReactNode => {
      if (tier.winners.length === 0) return null
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-end",
            justifyContent: "center",
            gap: "4px",
          }}
        >
          {tier.winners.map((w, i) =>
            w.dataUrl ? (
              <img
                key={i}
                src={w.dataUrl}
                style={{
                  height: `${heroHeight}px`,
                  width: "auto",
                  objectFit: "contain",
                  objectPosition: "bottom center",
                  // Slight drop-shadow for depth
                  filter: "drop-shadow(0 8px 24px rgba(0,0,0,0.7))",
                }}
              />
            ) : (
              // Fallback silhouette if image couldn't be fetched
              <div
                key={i}
                style={{
                  height: `${heroHeight}px`,
                  width: `${Math.round(heroHeight * 0.5)}px`,
                  background:
                    "linear-gradient(180deg, #3a4a1a 0%, #1a2a0a 100%)",
                  borderRadius: "8px 8px 0 0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#d4af37",
                  fontSize: "48px",
                }}
              >
                ✦
              </div>
            ),
          )}
        </div>
      )
    }

    const podiumBlock = (
      tier: TierData,
      tierHeight: number,
      heroHeight: number,
      width: number,
    ): React.ReactNode => {
      const rankLabel = tier.rank.toString()
      const isFirst = tier.rank === 1
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-end",
            width: `${width}px`,
          }}
        >
          {/* Hero images above the block */}
          {heroImages(tier, heroHeight)}

          {/* Tier name labels */}
          {tier.winners.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                gap: "8px",
                marginBottom: "6px",
              }}
            >
              {tier.winners.map((w, i) => (
                <div
                  key={i}
                  style={{
                    color: "#d4af37",
                    fontSize: "13px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                  }}
                >
                  {w.alias ?? w.name}
                </div>
              ))}
            </div>
          )}

          {/* Podium block */}
          <div
            style={{
              width: `${width}px`,
              height: `${tierHeight}px`,
              background:
                "linear-gradient(180deg, #2a2a1e 0%, #1a1a10 50%, #0f0f08 100%)",
              border: "2px solid #4a4a2a",
              borderBottom: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
          >
            {/* Gold accent stripe at top of block */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: "3px",
                background:
                  isFirst
                    ? "linear-gradient(90deg, transparent, #d4af37, transparent)"
                    : "linear-gradient(90deg, transparent, #7a8a3a, transparent)",
              }}
            />
            {/* Rank number */}
            <div
              style={{
                color: "#d4af37",
                fontSize: isFirst ? "72px" : "56px",
                fontWeight: 900,
                letterSpacing: "-0.02em",
                textShadow: "0 2px 8px rgba(0,0,0,0.9), 0 0 20px rgba(212,175,55,0.3)",
                fontFamily: "serif",
              }}
            >
              {rankLabel}
            </div>
            {/* Lotus on 1st place block */}
            {isFirst && (
              <div
                style={{
                  position: "absolute",
                  bottom: "12px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  color: "#d4af37",
                  fontSize: "20px",
                  opacity: 0.6,
                }}
              >
                ✿
              </div>
            )}
          </div>
        </div>
      )
    }

    // Column widths: 2nd | 1st | 3rd
    const COL_2 = 440
    const COL_1 = 520
    const COL_3 = 440
    const PODIUM_AREA_H = Math.max(...Object.values(TIER_HEIGHTS)) + Math.max(...Object.values(HERO_HEIGHT)) + 80

    const imageResponse = new ImageResponse(
      (
        <div
          style={{
            width: `${WIDTH}px`,
            height: `${HEIGHT}px`,
            background: "linear-gradient(180deg, #0a0a0a 0%, #111108 40%, #0d0d05 100%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
            fontFamily: "sans-serif",
            overflow: "hidden",
            position: "relative",
          }}
        >
          {/* Subtle city-skyline silhouette layer */}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "220px",
              background:
                "linear-gradient(180deg, transparent 0%, rgba(20,30,10,0.4) 100%)",
            }}
          />

          {/* Top banner */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              paddingTop: "28px",
              paddingBottom: "16px",
              width: "100%",
              borderBottom: "2px solid rgba(212,175,55,0.3)",
              background: "rgba(0,0,0,0.4)",
            }}
          >
            <div
              style={{
                color: "#d4af37",
                fontSize: "36px",
                fontWeight: 900,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                textShadow: "0 2px 12px rgba(212,175,55,0.5)",
              }}
            >
              Motta Alliance — Tommy Awards
            </div>
            <div
              style={{
                color: "#a8c566",
                fontSize: "18px",
                fontWeight: 600,
                letterSpacing: "0.08em",
                marginTop: "4px",
              }}
            >
              {opts.weekLabel}
            </div>
          </div>

          {/* Podium area */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-end",
              justifyContent: "center",
              flex: 1,
              paddingBottom: "0px",
              gap: "8px",
              width: "100%",
              maxWidth: `${COL_2 + COL_1 + COL_3 + 32}px`,
            }}
          >
            {/* 2nd place — left */}
            {podiumBlock(tier2, TIER_HEIGHTS[2], HERO_HEIGHT[2], COL_2)}
            {/* 1st place — centre (tallest) */}
            {podiumBlock(tier1, TIER_HEIGHTS[1], HERO_HEIGHT[1], COL_1)}
            {/* 3rd place — right */}
            {podiumBlock(tier3, TIER_HEIGHTS[3], HERO_HEIGHT[3], COL_3)}
          </div>
        </div>
      ),
      {
        width: WIDTH,
        height: HEIGHT,
      },
    )

    // ── 4. Stream to Buffer → upload to Blob ─────────────────────
    const arrayBuffer = await imageResponse.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

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

    console.log("[v0] tommy podium compositor: image uploaded →", blob.url)
    return { imageUrl: blob.url, method: "compositor" }
  } catch (err) {
    console.error("[v0] tommy podium compositor: failed:", err)
    return null
  }
}
