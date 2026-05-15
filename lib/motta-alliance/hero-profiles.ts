// ─────────────────────────────────────────────────────────────────────
// MOTTA ALLIANCE — Hero Profile Registry
// ─────────────────────────────────────────────────────────────────────
// Each row of this registry maps a real Motta teammate (by canonical
// full name + any alternate name spellings we've seen in Karbon /
// Supabase) to their comic-book "Hero Profile" page.
//
// The profile page lives as a single high-resolution PNG on Vercel
// Blob — produced by the design team alongside each issue of the
// Motta Financial Alliance comic series. We surface it in two places:
//
//   1. The teammates directory ("/teammates") — every active member
//      with a matching profile gets a "View Hero Profile" action on
//      their card that opens a modal showing the full page.
//   2. The Motta Alliance gallery ("/motta-alliance") — a dedicated
//      "Hero Profiles" section that lets anyone browse the whole
//      roster like a Marvel handbook.
//
// Lookup is done by normalized name (lowercase, trimmed). If we add a
// teammate whose Karbon display name differs from the comic credit
// (e.g. "Andrew Gianares" vs. "OCP" vs. "Andrew \"OCP\" Gianares")
// we extend `aliases` rather than mutating the canonical entry, so
// the source-of-truth name stays predictable.

export interface HeroProfile {
  /** Stable slug used in URLs / React keys / blob filenames. */
  slug: string
  /** Canonical teammate name as it appears in the comic. */
  name: string
  /** Hero alias / superhero title. */
  alias: string
  /** One-line role descriptor — shown under the alias in modals. */
  role: string
  /** Best-of-roster signature quote. Rendered in italic on hover cards. */
  quote: string
  /** Team alignment color — picks one of the variant accents. */
  variant: "primary" | "amber" | "shadow"
  /** Public Blob URL of the full profile PNG. */
  imageUrl: string
  /**
   * Extra names this hero is known by in our internal data systems.
   * Lowercased, trimmed. The registry matcher checks `name` AND every
   * alias when resolving a teammate row to a profile, so adding a new
   * spelling here is a one-line change.
   */
  aliases: string[]
}

// The canonical roster. Add new profiles by appending to this array
// — order is preserved when rendering the gallery, so the founding
// A-Team members stay up top.
export const HERO_PROFILES: HeroProfile[] = [
  {
    slug: "dat-le",
    name: "Dat Le",
    alias: "The Captain",
    role: "Infinite Intelligence. Limitless Innovation.",
    quote: "The best way to predict the future is to build it.",
    variant: "primary",
    imageUrl:
      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/MA_Dat%20Le-vz1djcsmozLsMpaqcXKe2tgS5TFZnh.png",
    aliases: ["dat le", "the captain"],
  },
  {
    slug: "mark-dwyer",
    name: "Mark Dwyer",
    alias: "The Stabilizer",
    role: "Strategic Planning. Wealth Management. Legacy.",
    quote: "I don't chase wealth. I protect it. I build it. I pass it on.",
    variant: "primary",
    imageUrl:
      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/MA_Mark%20Dwyer-nGT4mZBTZVMoS6SnmOluddgOz1FdPS.png",
    aliases: ["mark dwyer", "the stabilizer"],
  },
  {
    slug: "caleb-long",
    name: "Caleb Long",
    alias: "The Financial Optimizer",
    role: "Cleans Up Chaos. Makes Processes Efficient. M&A Is His Superpower.",
    quote:
      "Strategy without execution is just an idea. Execution without strategy is just busy work.",
    variant: "primary",
    imageUrl:
      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/MA_Caleb%20Long-fwNGzhdAFosRfAwdnhbhe3fgRiEfU4.png",
    aliases: ["caleb long", "the financial optimizer"],
  },
  {
    slug: "amy-sparaco",
    name: "Amy Sparaco",
    alias: "The Ledger Oracle",
    role: "Accounting Leadership. Financial Reporting. Team Support.",
    quote:
      "I turn numbers into clarity — so the team can change the game.",
    variant: "amber",
    imageUrl:
      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/MA_Amy%20Sparaco-vDEPVYSRH30YlXaAqNGA7DQjcgXgcI.png",
    aliases: ["amy sparaco", "the ledger oracle", "the newest member"],
  },
  {
    slug: "micaela-palacios",
    name: "Micaela Palacios",
    alias: "The Emerging Force",
    role: "Elite Talent in Tax, Accounting & Advisory.",
    quote:
      "I didn't come here to learn the system. I came to upgrade it.",
    variant: "primary",
    imageUrl:
      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/MA_Micaela%20Palacios-ICjehWYdgdhf6sLbdwZPGHKz7OV8KS.png",
    aliases: ["micaela palacios", "the emerging force"],
  },
  {
    slug: "ocp-andrew-gianares",
    name: "Andrew Gianares",
    alias: "OCP — The Work Crusher",
    role: "Execution & Accounting Assault.",
    quote: "I don't make excuses. I make it happen. Then I send it the invoice.",
    variant: "primary",
    imageUrl:
      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/MA_OCP-11kcCVPro8PnTfDSIWc9LAhLFNks2e.png",
    aliases: [
      "andrew gianares",
      "andrew \"ocp\" gianares",
      'andrew "ocp" gianares',
      "ocp",
      "the work crusher",
    ],
  },
  {
    slug: "samprina-zekio",
    name: "Samprina Zekio",
    alias: "The Code Keeper",
    role: "Software Development Intern / ALFRED Platform Builder.",
    quote:
      "I don't just maintain the system. I make it smarter.",
    variant: "primary",
    imageUrl:
      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/MA_Samprina%20Zekio-eKpLU61IxTeFA5CLS2ErpzdA2GqMHN.png",
    aliases: ["samprina zekio", "the code keeper"],
  },
  {
    slug: "alfred",
    name: "ALFRED",
    alias: "The AI Operative",
    role: "Autonomous Logistics & Financial Reasoning Engine for the Drey-team.",
    quote: "I don't sleep. I don't forget. I just keep the engine running.",
    variant: "shadow",
    imageUrl: "/images/alfred-logo.png",
    aliases: [
      "alfred",
      "alfred ai",
      "alfred service account",
      "info@mottafinancial.com",
      "the ai operative",
    ],
  },
  {
    slug: "p24-shadow-task-force",
    name: "Ganesh & Thameem",
    alias: "P24 — Shadow Operators",
    role: "Motta's Shadow Task Force. Behind the Scenes. Ahead of Every Win.",
    quote:
      "We work in the dark so the A-Team can shine in the light.",
    variant: "shadow",
    imageUrl:
      "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/P24_%20The%20shadow%20task%20force%20in%20action-19byT36IZOWTPGSIC5xCsBw9RNu4NT.png",
    aliases: [
      "ganesh",
      "thameem",
      "ganesh & thameem",
      "ganesh and thameem",
      "p24",
      "p24 shadow operators",
    ],
  },
]

/** Normalize a free-form name for case-insensitive matching. */
function normalizeName(name?: string | null): string {
  return (name || "").trim().toLowerCase()
}

/**
 * Resolve a hero profile by slug. This is the PRIMARY lookup method
 * when the team_member row has a `hero_profile_slug` column set.
 * Returns `null` when no match exists.
 */
export function findHeroProfileBySlug(slug?: string | null): HeroProfile | null {
  if (!slug) return null
  const normalizedSlug = slug.trim().toLowerCase()
  return HERO_PROFILES.find((h) => h.slug.toLowerCase() === normalizedSlug) ?? null
}

/**
 * Resolve a teammate name (or any of their known aliases) to a hero
 * profile. Returns `null` when no match exists so callers can fall
 * back gracefully — not every teammate has been comic-ified yet.
 * 
 * @deprecated Prefer `findHeroProfileBySlug` when the team_member row
 * has a `hero_profile_slug` column. Name-based matching is kept as a
 * fallback for backward compatibility.
 */
export function findHeroProfile(name?: string | null): HeroProfile | null {
  const needle = normalizeName(name)
  if (!needle) return null

  for (const hero of HERO_PROFILES) {
    if (normalizeName(hero.name) === needle) return hero
    if (hero.aliases.some((a) => normalizeName(a) === needle)) return hero
  }

  // Last-resort partial match — useful when Karbon stores "Andrew G."
  // or someone's full middle name. We only accept partials that match
  // EITHER the canonical first name OR last name in full, so "Mark"
  // doesn't accidentally pick up "Mark Twain".
  for (const hero of HERO_PROFILES) {
    const parts = hero.name.toLowerCase().split(/\s+/)
    if (parts.some((p) => p.length > 2 && needle.split(/\s+/).includes(p))) {
      return hero
    }
  }

  return null
}

/** Convenience getter for the comic-book cover image URL used as the
 *  Alliance hero / dashboard accent.  */
export const ALLIANCE_COVER_URL =
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/MA_Cover%20Page-2unLH7pf8deipZh4a3m6kzTeONzPqJ.png"

export const ALLIANCE_SUBCOVER_URL =
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/MA_Sub%20Cover-pM9Pud6BhB9lMYMemt0JSAeRgQ58fU.png"
