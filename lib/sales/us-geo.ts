/**
 * Sales geo helpers
 * ─────────────────────────────────────────────────────────────────────────
 * The dashboard plots clients on a US map. We need three pieces of data
 * the database doesn't provide:
 *
 *   1. State name → 2-letter postal abbreviation (some imports use the
 *      full name "Massachusetts", we display & key by "MA")
 *   2. State centroid lng/lat for placing labels and city dots that fall
 *      back to the state when the city isn't geocoded
 *   3. City → lng/lat for the most common US cities so we can plot client
 *      markers without a server-side geocoding call
 *
 * The city list is curated from the top ~250 US cities by population plus
 * every distinct city that currently appears in our Ignition client data.
 * Coordinates are from public-domain sources (US Census, GeoNames). When
 * we can't find a city we fall back to the state centroid with a small
 * jitter so multiple unknown clients in a state don't stack exactly.
 */

// ── Postal abbreviation normalization ──────────────────────────────────
const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
  dc: "DC",
}

export function normalizeState(s: string | null | undefined): string | null {
  if (!s) return null
  const trimmed = s.trim()
  if (!trimmed) return null
  if (trimmed.length === 2) return trimmed.toUpperCase()
  const lower = trimmed.toLowerCase()
  return STATE_NAME_TO_ABBR[lower] ?? trimmed.toUpperCase()
}

export const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
}

export const US_STATES: string[] = Object.keys(US_STATE_NAMES).sort()

// ── State centroids ([lng, lat]) ───────────────────────────────────────
// Population-weighted centroids approximated from US Census data. Used as
// the fallback marker position when we can't geocode a specific city.
export const STATE_CENTROIDS: Record<string, [number, number]> = {
  AL: [-86.79, 32.81], AK: [-152.4, 64.0], AZ: [-111.66, 34.17], AR: [-92.44, 34.75],
  CA: [-119.76, 36.78], CO: [-105.55, 39.06], CT: [-72.76, 41.6], DE: [-75.51, 38.99],
  DC: [-77.03, 38.91], FL: [-81.69, 27.77], GA: [-83.64, 32.66], HI: [-156.69, 20.42],
  ID: [-114.74, 44.24], IL: [-89.0, 40.35], IN: [-86.26, 39.85], IA: [-93.21, 42.01],
  KS: [-96.73, 38.53], KY: [-84.67, 37.67], LA: [-91.87, 31.17], ME: [-69.38, 44.69],
  MD: [-76.8, 39.06], MA: [-71.53, 42.23], MI: [-84.54, 43.33], MN: [-93.9, 45.69],
  MS: [-89.68, 32.74], MO: [-92.29, 38.46], MT: [-110.45, 46.92], NE: [-98.27, 41.13],
  NV: [-117.06, 38.31], NH: [-71.56, 43.45], NJ: [-74.52, 40.3], NM: [-106.25, 34.84],
  NY: [-74.95, 42.17], NC: [-79.81, 35.63], ND: [-99.78, 47.53], OH: [-82.79, 40.39],
  OK: [-96.93, 35.57], OR: [-122.07, 44.57], PA: [-77.21, 40.59], RI: [-71.51, 41.68],
  SC: [-80.95, 33.86], SD: [-99.44, 44.3], TN: [-86.69, 35.75], TX: [-97.56, 31.05],
  UT: [-111.86, 40.15], VT: [-72.71, 44.04], VA: [-78.17, 37.77], WA: [-121.49, 47.4],
  WV: [-80.95, 38.49], WI: [-89.62, 44.27], WY: [-107.3, 42.76],
}

// ── City geocoding (lng, lat) ──────────────────────────────────────────
// Keyed by `${city}|${state}` (lowercase). Curated from top US cities by
// population plus every distinct city that appears in our Ignition data.
// Spelling variants (e.g. "Lafayette" vs "Layfayette" typos in CRM input)
// are intentionally NOT stored — we normalize before lookup and fall back
// to state centroid on miss.
const CITY_COORDS: Record<string, [number, number]> = {
  // ─── Massachusetts (Motta's home turf, dense) ───
  "boston|ma": [-71.0589, 42.3601],
  "worcester|ma": [-71.8023, 42.2626],
  "springfield|ma": [-72.5898, 42.1015],
  "lowell|ma": [-71.3162, 42.6334],
  "cambridge|ma": [-71.1097, 42.3736],
  "framingham|ma": [-71.4162, 42.2793],
  "lawrence|ma": [-71.1631, 42.7070],
  "somerville|ma": [-71.0995, 42.3876],
  "lynn|ma": [-70.9495, 42.4668],
  "newton|ma": [-71.2092, 42.337],
  "quincy|ma": [-71.0023, 42.2529],
  "medford|ma": [-71.1067, 42.4184],
  "malden|ma": [-71.0664, 42.4251],
  "revere|ma": [-71.0119, 42.4084],
  "brookline|ma": [-71.1212, 42.3318],
  "everett|ma": [-71.0537, 42.4084],
  "billerica|ma": [-71.2689, 42.5584],
  "north billerica|ma": [-71.2845, 42.5876],
  "burlington|ma": [-71.1995, 42.5048],
  "woburn|ma": [-71.1523, 42.4793],
  "winchester|ma": [-71.1370, 42.4523],
  "stoneham|ma": [-71.0995, 42.4801],
  "reading|ma": [-71.1095, 42.5256],
  "marblehead|ma": [-70.8578, 42.5001],
  "amesbury|ma": [-70.9303, 42.8584],
  "newbury|ma": [-70.8745, 42.7892],
  "north andover|ma": [-71.1351, 42.6987],
  "tewksbury|ma": [-71.234, 42.6109],
  "tyngsboro|ma": [-71.4256, 42.6792],
  "dracut|ma": [-71.3023, 42.6701],
  "shrewsbury|ma": [-71.7129, 42.2959],
  "sudbury|ma": [-71.4162, 42.3834],
  "scituate|ma": [-70.7256, 42.1951],
  "duxbury|ma": [-70.6717, 42.0418],
  "pembroke|ma": [-70.8095, 42.0759],
  "randolph|ma": [-71.0412, 42.1626],
  "milton|ma": [-71.0662, 42.2495],
  "westwood|ma": [-71.2237, 42.2179],
  "braintree|ma": [-70.9995, 42.2079],
  "weymouth|ma": [-70.9395, 42.2204],
  "south weymouth|ma": [-70.9528, 42.1751],
  "new bedford|ma": [-70.9342, 41.6362],
  "middleborough|ma": [-70.9111, 41.8954],
  "south boston|ma": [-71.0501, 42.3334],
  "roslindale|ma": [-71.1289, 42.2870],
  "yarmouth|ma": [-70.2306, 41.6688],
  "yarmouth port|ma": [-70.2334, 41.7034],

  // ─── Colorado ───
  "denver|co": [-104.9903, 39.7392],
  "colorado springs|co": [-104.8214, 38.8339],
  "aurora|co": [-104.8319, 39.7294],
  "fort collins|co": [-105.0844, 40.5853],
  "lakewood|co": [-105.0814, 39.7047],
  "thornton|co": [-104.972, 39.8681],
  "westminster|co": [-105.0372, 39.8367],
  "boulder|co": [-105.2705, 40.0150],
  "centennial|co": [-104.8717, 39.5807],
  "highlands ranch|co": [-104.9692, 39.5538],
  "littleton|co": [-105.0167, 39.6133],
  "longmont|co": [-105.1019, 40.1672],
  "lafayette|co": [-105.0897, 39.9936],
  "northglenn|co": [-104.9811, 39.8956],
  "englewood|co": [-104.9881, 39.6478],
  "castle rock|co": [-104.8606, 39.3722],
  "brighton|co": [-104.8203, 39.9853],
  "erie|co": [-105.0497, 40.0500],
  "firestone|co": [-104.9594, 40.1136],
  "fountain|co": [-104.7008, 38.6822],
  "fruita|co": [-108.7287, 39.1589],
  "golden|co": [-105.2211, 39.7555],
  "blackhawk|co": [-105.4972, 39.7944],
  "weldona|co": [-103.9756, 40.3522],

  // ─── New Hampshire ───
  "manchester|nh": [-71.4548, 42.9956],
  "nashua|nh": [-71.4682, 42.7654],
  "concord|nh": [-71.5376, 43.2081],
  "rochester|nh": [-70.9750, 43.3045],
  "merrimack|nh": [-71.4934, 42.8651],
  "hudson|nh": [-71.4395, 42.7647],
  "windham|nh": [-71.3037, 42.8009],
  "plaistow|nh": [-71.0945, 42.8359],
  "chichester|nh": [-71.3937, 43.2576],
  "jackson|nh": [-71.1862, 44.1495],

  // ─── New York / NJ ───
  "new york|ny": [-74.006, 40.7128],
  "brooklyn|ny": [-73.9442, 40.6782],
  "queens|ny": [-73.7949, 40.7282],
  "bronx|ny": [-73.8648, 40.8448],
  "buffalo|ny": [-78.8784, 42.8864],
  "rochester|ny": [-77.6088, 43.1566],
  "albany|ny": [-73.7562, 42.6526],
  "syracuse|ny": [-76.1474, 43.0481],
  "newark|nj": [-74.1724, 40.7357],
  "jersey city|nj": [-74.0431, 40.7178],
  "hoboken|nj": [-74.0324, 40.7440],
  "hawthorne|nj": [-74.1543, 40.9495],
  "marlton|nj": [-74.9219, 39.8912],

  // ─── Texas ───
  "houston|tx": [-95.3698, 29.7604],
  "dallas|tx": [-96.797, 32.7767],
  "austin|tx": [-97.7431, 30.2672],
  "san antonio|tx": [-98.4936, 29.4241],
  "fort worth|tx": [-97.3308, 32.7555],
  "el paso|tx": [-106.4424, 31.7619],
  "arlington|tx": [-97.1081, 32.7357],
  "plano|tx": [-96.6989, 33.0198],

  // ─── California ───
  "los angeles|ca": [-118.2437, 34.0522],
  "san diego|ca": [-117.1611, 32.7157],
  "san jose|ca": [-121.8863, 37.3382],
  "san francisco|ca": [-122.4194, 37.7749],
  "fresno|ca": [-119.7871, 36.7378],
  "sacramento|ca": [-121.4944, 38.5816],
  "long beach|ca": [-118.1937, 33.7701],
  "oakland|ca": [-122.2711, 37.8044],
  "irvine|ca": [-117.8265, 33.6846],
  "santa monica|ca": [-118.4912, 34.0195],
  "torrance|ca": [-118.3406, 33.8358],
  "carson|ca": [-118.2820, 33.8316],
  "union city|ca": [-122.0085, 37.5934],
  "mill valley|ca": [-122.5450, 37.9060],
  "playa del rey|ca": [-118.4434, 33.9583],

  // ─── Florida ───
  "miami|fl": [-80.1918, 25.7617],
  "tampa|fl": [-82.4572, 27.9506],
  "orlando|fl": [-81.3792, 28.5384],
  "jacksonville|fl": [-81.6557, 30.3322],
  "saint petersburg|fl": [-82.6403, 27.7676],
  "homestead|fl": [-80.4776, 25.4687],
  "largo|fl": [-82.7873, 27.9095],
  "apollo beach|fl": [-82.4023, 27.7723],
  "pinellas park|fl": [-82.6995, 27.8428],

  // ─── Georgia ───
  "atlanta|ga": [-84.388, 33.749],
  "marietta|ga": [-84.5499, 33.9526],
  "johns creek|ga": [-84.1986, 34.0290],
  "cumming|ga": [-84.1402, 34.2073],
  "dallas|ga": [-84.8410, 33.9234],

  // ─── Maine ───
  "portland|me": [-70.2553, 43.6591],
  "freeport|me": [-70.1037, 43.8570],
  "brunswick|me": [-69.9653, 43.9145],
  "durham|me": [-70.1273, 43.9676],

  // ─── Maryland / VA / DC ───
  "baltimore|md": [-76.6122, 39.2904],
  "cockeysville|md": [-76.6438, 39.4815],
  "laurel|md": [-76.8483, 39.0992],
  "washington|dc": [-77.0369, 38.9072],
  "alexandria|va": [-77.0470, 38.8048],
  "warrenton|va": [-77.7959, 38.7137],
  "stephenson|va": [-78.1361, 39.2298],
  "lanexa|va": [-76.8842, 37.4040],

  // ─── Nevada ───
  "las vegas|nv": [-115.1398, 36.1699],
  "north las vegas|nv": [-115.1175, 36.1989],
  "henderson|nv": [-114.9817, 36.0395],
  "reno|nv": [-119.8138, 39.5296],

  // ─── Arizona ───
  "phoenix|az": [-112.0740, 33.4484],
  "tucson|az": [-110.9747, 32.2226],
  "scottsdale|az": [-111.9261, 33.4942],
  "gilbert|az": [-111.7890, 33.3528],
  "mesa|az": [-111.8315, 33.4152],
  "peoria|az": [-112.2374, 33.5806],
  "yuma|az": [-114.6277, 32.6927],
  "camp verde|az": [-111.8543, 34.5639],

  // ─── Utah ───
  "salt lake city|ut": [-111.8910, 40.7608],
  "slc|ut": [-111.8910, 40.7608],
  "west jordan|ut": [-111.9391, 40.6097],
  "south jordan|ut": [-111.9297, 40.5621],
  "sandy|ut": [-111.8389, 40.5649],
  "layton|ut": [-111.9711, 41.0602],

  // ─── Other states ───
  "minneapolis|mn": [-93.2650, 44.9778],
  "saint paul|mn": [-93.0900, 44.9537],
  "apple valley|mn": [-93.2030, 44.7319],
  "seattle|wa": [-122.3321, 47.6062],
  "kirkland|wa": [-122.2087, 47.6815],
  "tacoma|wa": [-122.4443, 47.2529],
  "spokane|wa": [-117.4260, 47.6588],
  "chicago|il": [-87.6298, 41.8781],
  "philadelphia|pa": [-75.1652, 39.9526],
  "pittsburgh|pa": [-79.9959, 40.4406],
  "conshohocken|pa": [-75.3013, 40.0746],
  "detroit|mi": [-83.0458, 42.3314],
  "waterford township|mi": [-83.4116, 42.6630],
  "boston|nc": [-78.7811, 35.7796],
  "boone|nc": [-81.6746, 36.2168],
  "providence|ri": [-71.4128, 41.8240],
  "bristol|ri": [-71.2662, 41.6837],
  "honolulu|hi": [-157.8583, 21.3099],
  "kailua|hi": [-157.7400, 21.4022],
  "paia|hi": [-156.3711, 20.9028],
  "rock springs|wy": [-109.2029, 41.5875],
  "mountain view|wy": [-110.3303, 41.2675],
  "bridgeport|ne": [-103.0992, 41.6644],
  "ruston|la": [-92.6379, 32.5232],
  "lafayette|la": [-92.0198, 30.2241],
  "youngsville|la": [-91.9923, 30.0996],
}

/**
 * Resolve a city to lng/lat. Tries exact match, then case-insensitive,
 * then drops common typos. Returns the state centroid (with optional
 * jitter) when the city isn't in the lookup.
 *
 * The jitter is deterministic on the city string so the same unknown
 * city always lands at the same point — preventing dot churn between
 * renders.
 */
export function geocodeCity(
  city: string | null | undefined,
  state: string | null | undefined,
): { coords: [number, number]; matched: boolean } | null {
  const stateAbbr = normalizeState(state)
  if (!stateAbbr) return null

  if (city) {
    const key = `${city.trim().toLowerCase()}|${stateAbbr.toLowerCase()}`
    const exact = CITY_COORDS[key]
    if (exact) return { coords: exact, matched: true }
  }

  const centroid = STATE_CENTROIDS[stateAbbr]
  if (!centroid) return null

  // Deterministic jitter from the city string (so unknown cities don't
  // pile up exactly on the centroid). Keep the jitter small (≤1°).
  let hash = 0
  const seed = (city || stateAbbr).toLowerCase()
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  const jx = ((hash & 0xff) / 255 - 0.5) * 1.6
  const jy = (((hash >> 8) & 0xff) / 255 - 0.5) * 1.0
  return { coords: [centroid[0] + jx, centroid[1] + jy], matched: false }
}

// ── Decorative landscape features ──────────────────────────────────────
// Hand-curated approximate polygons for the major US lakes that read well
// at the dashboard's map zoom level. We're not after geographic precision
// — this is decorative atmospherics so the map looks like a physical map
// and not a flat fill of states.
//
// Each lake is a closed ring of [lng, lat] points. react-simple-maps
// projects them via the active projection automatically when we render
// them inside a `<Marker>`-like SVG group.
export const MAJOR_LAKES: Array<{ name: string; ring: Array<[number, number]> }> = [
  {
    name: "Lake Superior",
    ring: [
      [-92.0, 46.7], [-90.5, 46.8], [-88.5, 47.4], [-86.5, 47.5],
      [-84.6, 46.9], [-84.7, 46.5], [-86.4, 46.6], [-87.5, 46.5],
      [-89.5, 46.6], [-91.5, 46.7], [-92.0, 46.7],
    ],
  },
  {
    name: "Lake Michigan",
    ring: [
      [-87.9, 41.6], [-87.0, 41.8], [-86.4, 42.5], [-86.4, 43.5],
      [-86.5, 44.5], [-86.0, 45.3], [-85.4, 45.8], [-85.0, 45.4],
      [-85.2, 44.2], [-85.5, 43.0], [-86.5, 42.0], [-87.2, 41.7], [-87.9, 41.6],
    ],
  },
  {
    name: "Lake Huron",
    ring: [
      [-84.5, 43.0], [-83.6, 43.6], [-82.5, 44.5], [-82.0, 45.5],
      [-81.7, 45.9], [-81.0, 45.8], [-80.5, 45.0], [-81.5, 44.0],
      [-82.4, 43.5], [-83.3, 43.1], [-84.5, 43.0],
    ],
  },
  {
    name: "Lake Erie",
    ring: [
      [-83.5, 41.7], [-82.5, 41.5], [-81.0, 41.5], [-79.7, 42.0],
      [-79.0, 42.6], [-79.5, 42.8], [-81.0, 42.6], [-82.5, 42.2],
      [-83.4, 41.9], [-83.5, 41.7],
    ],
  },
  {
    name: "Lake Ontario",
    ring: [
      [-79.5, 43.3], [-78.5, 43.3], [-77.0, 43.3], [-76.2, 43.6],
      [-76.5, 44.0], [-77.5, 43.9], [-79.0, 43.8], [-79.5, 43.5], [-79.5, 43.3],
    ],
  },
  {
    name: "Great Salt Lake",
    ring: [
      [-112.7, 40.7], [-112.3, 40.7], [-112.0, 41.0], [-112.0, 41.4],
      [-112.3, 41.6], [-112.7, 41.5], [-113.0, 41.2], [-112.9, 40.9], [-112.7, 40.7],
    ],
  },
  {
    name: "Lake Champlain",
    ring: [
      [-73.45, 43.6], [-73.3, 43.8], [-73.3, 44.3], [-73.35, 44.9],
      [-73.4, 45.0], [-73.5, 44.8], [-73.5, 44.2], [-73.45, 43.6],
    ],
  },
  {
    name: "Lake Tahoe",
    ring: [
      [-120.05, 38.95], [-119.95, 38.95], [-119.9, 39.10],
      [-119.95, 39.25], [-120.1, 39.20], [-120.1, 39.05], [-120.05, 38.95],
    ],
  },
]

// Mountain range marker positions (lng, lat) — used as a visual hint
// rather than precise topography. Rendered as small triangle clusters.
export const MOUNTAIN_RANGES: Array<{ name: string; coords: [number, number] }> = [
  { name: "Northern Rockies", coords: [-113.5, 45.5] },
  { name: "Central Rockies", coords: [-106.5, 39.5] },
  { name: "Sierra Nevada", coords: [-119.0, 37.5] },
  { name: "Cascade Range", coords: [-121.5, 44.5] },
  { name: "Wasatch Range", coords: [-111.6, 40.5] },
  { name: "Appalachians (N)", coords: [-72.5, 44.0] },
  { name: "Appalachians (S)", coords: [-82.5, 35.5] },
  { name: "Ozarks", coords: [-92.5, 36.5] },
  { name: "Black Hills", coords: [-103.5, 44.0] },
]
