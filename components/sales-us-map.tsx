"use client"

/**
 * Sales US Map
 * ─────────────────────────────────────────────────────────────────────────
 * Choropleth-style map of the US showing proposal activity per state.
 *
 * Key design decisions:
 *
 *  • The map runs as a *view* over data the dashboard already filtered.
 *    The dashboard's date range and other filters are global; the map's
 *    own toggles (metric, service line, view) only change how that data
 *    is *displayed*, not what's fetched. Network-cheap, instant feedback.
 *
 *  • Three orthogonal toggles:
 *      – Metric: revenue / clients / proposals
 *      – Service line: All / Tax / Accounting / Advisory / Other
 *      – View: states (choropleth) / cities (bubble map)
 *
 *  • Visual style is "physical map":
 *      – Light blue water background
 *      – Sand-colored continental fill on states with no data
 *      – Sage→emerald color ramp on states with data
 *      – Decorative Great Lakes / Lake Tahoe / Salt Lake polygons
 *      – Subtle mountain-range markers as topographic hints
 *      – When viewing cities, the state fill drops back to neutral so
 *        the city dots carry the visual weight
 */

import { useState, useMemo, useCallback } from "react"
import Link from "next/link"
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
  Marker,
} from "react-simple-maps"
import { scaleQuantile, scaleSqrt } from "d3-scale"
import { motion, AnimatePresence } from "framer-motion"
import {
  X,
  MapPin,
  DollarSign,
  Users,
  ChevronRight,
  Building2,
  User,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ExternalLink,
  Layers,
  FileText,
  Calculator,
  Lightbulb,
  MoreHorizontal,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import {
  US_STATE_NAMES,
  MAJOR_LAKES,
  MOUNTAIN_RANGES,
  geocodeCity,
} from "@/lib/sales/us-geo"
import type { ServiceLine } from "@/lib/sales/service-line-classifier"

// US topology JSON from CDN. Cached at the edge.
const geoUrl = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"

// State FIPS → 2-letter abbreviation (us-atlas keys geographies by FIPS).
const FIPS_TO_ABBR: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
  "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
  "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN",
  "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
  "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
  "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
  "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
  "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
  "56": "WY",
}

// Color tokens. Kept as raw values rather than tailwind classes because
// react-simple-maps wants strings on the `fill` prop.
const COLOR = {
  water: "#cfe7f5",        // ocean / lakes
  waterStroke: "#a8d3e8",  // lake outlines
  land: "#f4ecd8",         // sand / no-data state fill
  landStroke: "#cdbf9a",   // state border on sand
  ramp: ["#e1ead5", "#bcd2a6", "#86b07b", "#5a8f5e", "#3F7D58"], // 5-stop sage→emerald
  cityDot: "#3F7D58",
  cityDotStroke: "#ffffff",
  mountain: "#8a7858",     // muted brown for mountain markers
  selected: "#1F4E40",
} as const

// ── Types ──────────────────────────────────────────────────────────────
export interface CityStats {
  city: string
  state: string
  proposalCount: number
  acceptedValue: number
  clientCount: number
}

export interface StateData {
  state: string
  proposalCount: number
  acceptedValue: number
  totalValue: number
  pipelineValue?: number
  clientCount?: number
  clients: Array<{
    name: string
    id: string | null
    kind: "organization" | "contact" | null
    value: number
  }>
  byServiceLine?: Array<{
    serviceLine: ServiceLine
    revenue: number
    count: number
  }>
  cities?: CityStats[]
}

interface SalesUSMapProps {
  data: StateData[]
  loading?: boolean
}

// ── Toggles ────────────────────────────────────────────────────────────
type Metric = "revenue" | "clients" | "proposals"
type ViewMode = "states" | "cities"
type LineFilter = ServiceLine | "All"

const METRIC_LABEL: Record<Metric, string> = {
  revenue: "Accepted Revenue",
  clients: "Clients",
  proposals: "Proposals",
}

const SERVICE_LINE_ICON: Record<LineFilter, React.ReactNode> = {
  All: <Layers className="h-3 w-3" />,
  Tax: <FileText className="h-3 w-3" />,
  Accounting: <Calculator className="h-3 w-3" />,
  Advisory: <Lightbulb className="h-3 w-3" />,
  Other: <MoreHorizontal className="h-3 w-3" />,
}

// ── Formatters ─────────────────────────────────────────────────────────
const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n)

const fmtMoneyCompact = (n: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
  }).format(n)

const fmtCount = (n: number) => new Intl.NumberFormat("en-US").format(n)

// ── Component ──────────────────────────────────────────────────────────
export function SalesUSMap({ data, loading }: SalesUSMapProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [selectedState, setSelectedState] = useState<StateData | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState<[number, number]>([-96, 38])

  // View toggles
  const [metric, setMetric] = useState<Metric>("revenue")
  const [viewMode, setViewMode] = useState<ViewMode>("states")
  const [lineFilter, setLineFilter] = useState<LineFilter>("All")

  // ── Compute the per-state value used to drive both the choropleth ramp
  //    and the state detail panel. The metric/service-line toggles only
  //    affect this computed value — the underlying `data` is unchanged.
  const stateValue = useCallback(
    (s: StateData): number => {
      if (lineFilter !== "All") {
        // Service-line filtering only makes sense for revenue/proposal
        // counts. For "clients" we fall back to the unfiltered count
        // since we don't track which client did which service line here.
        const slice = s.byServiceLine?.find((b) => b.serviceLine === lineFilter)
        if (!slice) return 0
        if (metric === "revenue") return slice.revenue
        if (metric === "proposals") return slice.count
        return s.clientCount ?? s.clients.length
      }
      if (metric === "revenue") return s.acceptedValue
      if (metric === "proposals") return s.proposalCount
      return s.clientCount ?? s.clients.length
    },
    [metric, lineFilter],
  )

  const stateDataMap = useMemo(() => {
    const map = new Map<string, StateData>()
    for (const d of data) map.set(d.state, d)
    return map
  }, [data])

  // ── Color scale for the choropleth ──
  const colorScale = useMemo(() => {
    const values = data
      .map((d) => stateValue(d))
      .filter((v) => v > 0)
    if (values.length === 0) return () => COLOR.land
    return scaleQuantile<string>().domain(values).range(COLOR.ramp as unknown as string[])
  }, [data, stateValue])

  // ── City markers (only computed when viewing the cities map) ──
  type CityMarker = CityStats & { coords: [number, number]; geocoded: boolean }
  const cityMarkers = useMemo<CityMarker[]>(() => {
    if (viewMode !== "cities") return []
    const out: CityMarker[] = []
    for (const s of data) {
      for (const c of s.cities ?? []) {
        const geo = geocodeCity(c.city, c.state)
        if (!geo) continue
        out.push({ ...c, coords: geo.coords, geocoded: geo.matched })
      }
    }
    return out
  }, [data, viewMode])

  const cityScale = useMemo(() => {
    if (cityMarkers.length === 0) return () => 4
    const accessor =
      metric === "revenue"
        ? (c: CityMarker) => c.acceptedValue
        : metric === "clients"
        ? (c: CityMarker) => c.clientCount
        : (c: CityMarker) => c.proposalCount
    const max = Math.max(...cityMarkers.map(accessor), 1)
    return scaleSqrt<number, number>()
      .domain([0, max])
      .range([3, 22])
      .clamp(true) as unknown as (c: CityMarker) => number
  }, [cityMarkers, metric])

  const handleMouseMove = useCallback((e: React.MouseEvent, key: string) => {
    setHoveredKey(key)
    setTooltipPos({ x: e.clientX, y: e.clientY })
  }, [])

  const handleStateClick = useCallback(
    (stateAbbr: string) => {
      const stateData = stateDataMap.get(stateAbbr)
      if (stateData) setSelectedState(stateData)
    },
    [stateDataMap],
  )

  // Hover info — applies to either a state or a city depending on key prefix.
  const hoveredInfo = useMemo(() => {
    if (!hoveredKey) return null
    if (hoveredKey.startsWith("city:")) {
      const c = cityMarkers.find((m) => `city:${m.state}:${m.city}` === hoveredKey)
      return c ? { kind: "city" as const, city: c } : null
    }
    const stateData = stateDataMap.get(hoveredKey)
    return stateData ? { kind: "state" as const, state: stateData } : null
  }, [hoveredKey, cityMarkers, stateDataMap])

  // ── Stats summary (above-map ribbon) ──
  const summary = useMemo(() => {
    const filteredStates = data.filter((d) => stateValue(d) > 0)
    const totalRevenue = filteredStates.reduce(
      (sum, d) =>
        sum +
        (lineFilter === "All"
          ? d.acceptedValue
          : d.byServiceLine?.find((b) => b.serviceLine === lineFilter)?.revenue ?? 0),
      0,
    )
    const totalClients = filteredStates.reduce(
      (sum, d) => sum + (d.clientCount ?? d.clients.length),
      0,
    )
    const totalProposals = filteredStates.reduce(
      (sum, d) =>
        sum +
        (lineFilter === "All"
          ? d.proposalCount
          : d.byServiceLine?.find((b) => b.serviceLine === lineFilter)?.count ?? 0),
      0,
    )
    return {
      stateCount: filteredStates.length,
      totalRevenue,
      totalClients,
      totalProposals,
    }
  }, [data, stateValue, lineFilter])

  return (
    <Card className="border-stone-200 overflow-hidden relative">
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="text-sm font-medium text-stone-700 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-emerald-700" />
            Sales by Geography
          </CardTitle>
          <p className="text-xs text-stone-500 mt-0.5">
            {viewMode === "states"
              ? "Click a state to see clients · drag to pan, scroll to zoom"
              : "City bubbles are sized by the active metric"}
          </p>
        </div>

        {/* Toggles */}
        <div className="flex items-center gap-2 flex-wrap">
          <Tabs value={metric} onValueChange={(v) => setMetric(v as Metric)}>
            <TabsList className="h-7">
              <TabsTrigger value="revenue" className="text-xs px-2.5 h-5">
                Revenue
              </TabsTrigger>
              <TabsTrigger value="clients" className="text-xs px-2.5 h-5">
                Clients
              </TabsTrigger>
              <TabsTrigger value="proposals" className="text-xs px-2.5 h-5">
                Proposals
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Tabs value={lineFilter} onValueChange={(v) => setLineFilter(v as LineFilter)}>
            <TabsList className="h-7">
              {(["All", "Tax", "Accounting", "Advisory", "Other"] as LineFilter[]).map((l) => (
                <TabsTrigger key={l} value={l} className="text-xs px-2 h-5 gap-1">
                  {SERVICE_LINE_ICON[l]}
                  {l}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList className="h-7">
              <TabsTrigger value="states" className="text-xs px-2.5 h-5">
                States
              </TabsTrigger>
              <TabsTrigger value="cities" className="text-xs px-2.5 h-5">
                Cities
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-0.5 border-l border-stone-200 pl-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setZoom((z) => Math.min(z * 1.5, 4))}
              title="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setZoom((z) => Math.max(z / 1.5, 1))}
              title="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                setZoom(1)
                setCenter([-96, 38])
              }}
              title="Reset view"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 relative">
        <div
          className="relative h-[440px] overflow-hidden rounded-b-lg"
          style={{
            // Sky → water gradient gives the impression of a printed atlas.
            background:
              "linear-gradient(180deg, #e8f3fa 0%, #cfe7f5 60%, #b8dbed 100%)",
          }}
        >
          {/* Subtle paper-texture overlay */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-[0.18]"
            style={{
              backgroundImage:
                "radial-gradient(rgba(120,140,160,0.12) 1px, transparent 1px)",
              backgroundSize: "3px 3px",
            }}
          />

          <ComposableMap
            projection="geoAlbersUsa"
            projectionConfig={{ scale: 1000 }}
            style={{ width: "100%", height: "100%" }}
          >
            <ZoomableGroup
              zoom={zoom}
              center={center}
              onMoveEnd={({ coordinates, zoom: z }) => {
                setCenter(coordinates as [number, number])
                setZoom(z)
              }}
            >
              {/* States */}
              <Geographies geography={geoUrl}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const fips = geo.id
                    const stateAbbr = FIPS_TO_ABBR[fips]
                    if (!stateAbbr) return null
                    const stateData = stateDataMap.get(stateAbbr)
                    const value = stateData ? stateValue(stateData) : 0
                    const isSelected = selectedState?.state === stateAbbr
                    const hasData = value > 0

                    // In Cities view we want the choropleth to fade so
                    // the city dots dominate. In States view it does the
                    // heavy lifting.
                    const fill =
                      viewMode === "cities"
                        ? COLOR.land
                        : hasData
                        ? colorScale(value)
                        : COLOR.land

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        onMouseMove={(e) => handleMouseMove(e, stateAbbr)}
                        onMouseLeave={() => setHoveredKey(null)}
                        onClick={() => handleStateClick(stateAbbr)}
                        style={{
                          default: {
                            fill,
                            stroke: isSelected ? COLOR.selected : COLOR.landStroke,
                            strokeWidth: isSelected ? 1.6 : 0.6,
                            outline: "none",
                            cursor: hasData || viewMode === "cities" ? "pointer" : "default",
                            transition: "all 0.18s ease",
                          },
                          hover: {
                            fill:
                              viewMode === "cities"
                                ? "#ece1bf"
                                : hasData
                                ? "#74b07a"
                                : "#ece1bf",
                            stroke: COLOR.selected,
                            strokeWidth: 1.2,
                            outline: "none",
                            cursor: hasData || viewMode === "cities" ? "pointer" : "default",
                          },
                          pressed: {
                            fill: COLOR.selected,
                            stroke: COLOR.selected,
                            strokeWidth: 1.6,
                            outline: "none",
                          },
                        }}
                      />
                    )
                  })
                }
              </Geographies>

              {/* Decorative lakes (drawn AFTER states so they overlay
                  borders that pass through the lake). Each lake is a
                  closed ring of [lng, lat] points; <Marker> projects
                  them via the active projection. */}
              {MAJOR_LAKES.map((lake) => (
                <LakePolygon key={lake.name} ring={lake.ring} title={lake.name} />
              ))}

              {/* Mountain range hints — small triangle clusters at the
                  centroid of each named range. Decorative only. */}
              {MOUNTAIN_RANGES.map((range) => (
                <Marker key={range.name} coordinates={range.coords}>
                  <MountainGlyph />
                  <title>{range.name}</title>
                </Marker>
              ))}

              {/* City bubbles (Cities view only) */}
              {viewMode === "cities" &&
                cityMarkers.map((c) => {
                  const r = cityScale(c)
                  const key = `city:${c.state}:${c.city}`
                  const isHovered = hoveredKey === key
                  return (
                    <Marker key={key} coordinates={c.coords}>
                      <circle
                        r={r}
                        fill={COLOR.cityDot}
                        fillOpacity={isHovered ? 0.95 : 0.65}
                        stroke={COLOR.cityDotStroke}
                        strokeWidth={1.25}
                        style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
                        onMouseMove={(e) => handleMouseMove(e, key)}
                        onMouseLeave={() => setHoveredKey(null)}
                        onClick={() => {
                          const sd = stateDataMap.get(c.state)
                          if (sd) setSelectedState(sd)
                        }}
                      />
                    </Marker>
                  )
                })}
            </ZoomableGroup>
          </ComposableMap>

          {/* Hover tooltip */}
          <AnimatePresence>
            {hoveredInfo && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                className="fixed z-50 pointer-events-none"
                style={{
                  left: tooltipPos.x + 12,
                  top: tooltipPos.y - 10,
                }}
              >
                {hoveredInfo.kind === "state" ? (
                  <StateTooltip
                    state={hoveredInfo.state}
                    metric={metric}
                    lineFilter={lineFilter}
                  />
                ) : (
                  <CityTooltip city={hoveredInfo.city} />
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Legend */}
          <div className="absolute bottom-3 left-3 bg-white/85 backdrop-blur-sm rounded-lg px-3 py-2 border border-stone-200 shadow-sm">
            <div className="text-[10px] text-stone-600 mb-1.5 uppercase tracking-wide font-medium">
              {viewMode === "states"
                ? `${METRIC_LABEL[metric]}${lineFilter !== "All" ? ` · ${lineFilter}` : ""}`
                : "City size = " + METRIC_LABEL[metric]}
            </div>
            {viewMode === "states" ? (
              <>
                <div className="flex items-center gap-1">
                  {COLOR.ramp.map((color, i) => (
                    <div
                      key={i}
                      className="w-7 h-3 rounded-sm"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[9px] text-stone-500 mt-0.5">
                  <span>Low</span>
                  <span>High</span>
                </div>
              </>
            ) : (
              <div className="flex items-end gap-2 h-6">
                {[4, 8, 14, 20].map((r) => (
                  <div
                    key={r}
                    className="rounded-full"
                    style={{
                      width: r,
                      height: r,
                      backgroundColor: COLOR.cityDot,
                      opacity: 0.7,
                      border: "1px solid white",
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Stats overlay */}
          <div className="absolute top-3 right-3 bg-white/85 backdrop-blur-sm rounded-lg px-3 py-2 border border-stone-200 shadow-sm">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-[10px] text-stone-500 uppercase tracking-wide">
                  States
                </div>
                <div className="text-lg font-semibold text-stone-800 tabular-nums">
                  {summary.stateCount}
                </div>
              </div>
              <div className="w-px h-8 bg-stone-300" />
              <div>
                <div className="text-[10px] text-stone-500 uppercase tracking-wide">
                  {metric === "revenue"
                    ? "Revenue"
                    : metric === "clients"
                    ? "Clients"
                    : "Proposals"}
                </div>
                <div className="text-lg font-semibold text-emerald-700 tabular-nums">
                  {metric === "revenue"
                    ? fmtMoneyCompact(summary.totalRevenue)
                    : metric === "clients"
                    ? fmtCount(summary.totalClients)
                    : fmtCount(summary.totalProposals)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Selected state detail panel */}
        <AnimatePresence>
          {selectedState && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="absolute top-0 right-0 bottom-0 w-80 bg-stone-50 border-l border-stone-200 shadow-xl z-20"
            >
              <div className="p-4 border-b border-stone-200 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-stone-900 flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-emerald-600" />
                    {US_STATE_NAMES[selectedState.state] || selectedState.state}
                  </h3>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {selectedState.proposalCount} proposals
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setSelectedState(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="p-4 border-b border-stone-200">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
                    <div className="flex items-center gap-1.5 text-emerald-700 text-xs font-medium mb-1">
                      <DollarSign className="h-3.5 w-3.5" />
                      Won
                    </div>
                    <div className="text-lg font-semibold text-emerald-800 tabular-nums">
                      {fmtMoney(selectedState.acceptedValue)}
                    </div>
                  </div>
                  <div className="bg-stone-100 rounded-lg p-3 border border-stone-200">
                    <div className="flex items-center gap-1.5 text-stone-600 text-xs font-medium mb-1">
                      <Users className="h-3.5 w-3.5" />
                      Clients
                    </div>
                    <div className="text-lg font-semibold text-stone-800 tabular-nums">
                      {selectedState.clientCount ?? selectedState.clients.length}
                    </div>
                  </div>
                </div>
              </div>

              {/* Service-line breakdown for this state */}
              {selectedState.byServiceLine &&
              selectedState.byServiceLine.some((b) => b.revenue > 0) ? (
                <div className="px-4 py-3 border-b border-stone-200">
                  <h4 className="text-[10px] font-medium text-stone-500 uppercase tracking-wide mb-2">
                    By Service Line
                  </h4>
                  <ul className="space-y-1.5">
                    {selectedState.byServiceLine
                      .filter((b) => b.revenue > 0)
                      .map((b) => (
                        <li
                          key={b.serviceLine}
                          className="flex items-center justify-between text-xs"
                        >
                          <span className="flex items-center gap-1.5 text-stone-700">
                            {SERVICE_LINE_ICON[b.serviceLine as LineFilter]}
                            {b.serviceLine}
                          </span>
                          <span className="font-medium tabular-nums text-stone-800">
                            {fmtMoneyCompact(b.revenue)}
                            <span className="text-stone-400 ml-1">· {b.count}</span>
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}

              {/* Cities in this state */}
              {selectedState.cities && selectedState.cities.length > 0 ? (
                <div className="px-4 py-3 border-b border-stone-200">
                  <h4 className="text-[10px] font-medium text-stone-500 uppercase tracking-wide mb-2">
                    Top Cities
                  </h4>
                  <ul className="space-y-1">
                    {selectedState.cities.slice(0, 6).map((c) => (
                      <li
                        key={c.city}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-stone-700 truncate">{c.city}</span>
                        <span className="text-stone-500 tabular-nums shrink-0 ml-2">
                          {c.acceptedValue > 0
                            ? fmtMoneyCompact(c.acceptedValue)
                            : `${c.proposalCount} prop`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="p-3">
                <h4 className="text-xs font-medium text-stone-600 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <ChevronRight className="h-3 w-3" />
                  Top Clients
                </h4>
                <ScrollArea className="h-[180px]">
                  <ul className="space-y-1.5">
                    {selectedState.clients.map((client, i) => (
                      <li
                        key={client.id || client.name + i}
                        className="group flex items-center justify-between p-2 rounded-lg hover:bg-stone-100 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div
                            className={cn(
                              "w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0",
                              client.kind === "organization"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-amber-100 text-amber-700",
                            )}
                          >
                            {client.kind === "organization" ? (
                              <Building2 className="h-3.5 w-3.5" />
                            ) : (
                              <User className="h-3.5 w-3.5" />
                            )}
                          </div>
                          <div className="min-w-0">
                            {client.id ? (
                              <Link
                                href={`/clients/${client.kind === "organization" ? "org" : "contact"}/${client.id}`}
                                className="text-sm text-stone-800 hover:text-emerald-700 hover:underline truncate flex items-center gap-1"
                              >
                                {client.name}
                                <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                              </Link>
                            ) : (
                              <span className="text-sm text-stone-700 truncate block">
                                {client.name}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-sm font-medium text-stone-700 tabular-nums shrink-0 ml-2">
                          {fmtMoneyCompact(client.value)}
                        </span>
                      </li>
                    ))}
                    {selectedState.clients.length === 0 && (
                      <li className="text-center text-sm text-stone-500 py-4">
                        No clients with won deals
                      </li>
                    )}
                  </ul>
                </ScrollArea>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  )
}

// ── Sub-components ────────────────────────────────────────────────────

function StateTooltip({
  state,
  metric,
  lineFilter,
}: {
  state: StateData
  metric: Metric
  lineFilter: LineFilter
}) {
  const sliceForLine = state.byServiceLine?.find(
    (b) => b.serviceLine === lineFilter,
  )
  const value =
    lineFilter === "All"
      ? metric === "revenue"
        ? state.acceptedValue
        : metric === "proposals"
        ? state.proposalCount
        : state.clientCount ?? state.clients.length
      : metric === "revenue"
      ? sliceForLine?.revenue ?? 0
      : metric === "proposals"
      ? sliceForLine?.count ?? 0
      : state.clientCount ?? state.clients.length

  return (
    <div className="bg-white border border-stone-200 rounded-lg px-3 py-2 shadow-lg">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-stone-900 font-semibold">
          {US_STATE_NAMES[state.state] || state.state}
        </span>
        <Badge
          variant="outline"
          className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200"
        >
          {state.proposalCount} proposals
        </Badge>
      </div>
      <div className="text-stone-900 font-mono text-base">
        {metric === "revenue"
          ? fmtMoney(value)
          : `${fmtCount(value)} ${metric}`}
      </div>
      <div className="text-stone-500 text-xs mt-0.5">
        {state.clientCount ?? state.clients.length} clients
        {lineFilter !== "All" ? ` · ${lineFilter}` : ""}
      </div>
    </div>
  )
}

function CityTooltip({ city }: { city: CityStats }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg px-3 py-2 shadow-lg">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-stone-900 font-semibold">{city.city}</span>
        <Badge
          variant="outline"
          className="text-[10px] bg-stone-100 text-stone-700 border-stone-200"
        >
          {city.state}
        </Badge>
      </div>
      <div className="text-stone-900 font-mono text-base">
        {city.acceptedValue > 0 ? fmtMoney(city.acceptedValue) : "Pipeline"}
      </div>
      <div className="text-stone-500 text-xs mt-0.5">
        {city.clientCount} clients · {city.proposalCount} proposals
      </div>
    </div>
  )
}

/**
 * Lake polygon. We project each [lng, lat] vertex through the active
 * projection by wrapping the whole polygon in a single <Marker> at the
 * polygon's first point and then using <path> with manually-projected
 * relative coordinates. That doesn't work cleanly with react-simple-maps,
 * so instead we use d3-geo's projection via the parent ComposableMap by
 * rendering each vertex as a <Marker> and connecting them with a <path>.
 *
 * Simpler and reliable: render the polygon as a single SVG <polygon>
 * inside a single <Marker>, where the Marker sets the origin to the
 * polygon's first vertex. We then offset every other vertex relative to
 * that origin in the local projected space.
 *
 * In practice the lakes are small enough that a flat Mercator-style
 * pseudo-projection is visually indistinguishable from Albers — we just
 * scale lng/lat differences by an empirical factor that matches the
 * Albers projection used here. ~30px/degree at the dashboard's default
 * scale. This is intentionally a decorative approximation, NOT an
 * accurate cartographic rendering.
 */
function LakePolygon({ ring, title }: { ring: Array<[number, number]>; title: string }) {
  if (ring.length < 3) return null
  const origin = ring[0]
  // Empirical scaling matching projectionConfig.scale = 1000 with
  // geoAlbersUsa. Values tuned so lakes overlay at the right size at
  // default zoom — fine deviation is acceptable since these are decorative.
  const SX = 16
  const SY = -16
  const points = ring
    .map(([lng, lat]) => `${(lng - origin[0]) * SX},${(lat - origin[1]) * SY}`)
    .join(" ")
  return (
    <Marker coordinates={origin}>
      <polygon
        points={points}
        fill={COLOR.water}
        fillOpacity={0.9}
        stroke={COLOR.waterStroke}
        strokeWidth={0.6}
        style={{ pointerEvents: "none" }}
      />
      <title>{title}</title>
    </Marker>
  )
}

/** Tiny mountain-range glyph: 3 stacked triangles. */
function MountainGlyph() {
  return (
    <g pointerEvents="none" opacity={0.55}>
      <polygon
        points="-6,2 -2,-5 2,2"
        fill={COLOR.mountain}
        stroke="#6a5a3f"
        strokeWidth={0.4}
      />
      <polygon
        points="-1,2 3,-3 7,2"
        fill={COLOR.mountain}
        stroke="#6a5a3f"
        strokeWidth={0.4}
      />
      <polygon
        points="-9,2 -6,-2 -3,2"
        fill={COLOR.mountain}
        stroke="#6a5a3f"
        strokeWidth={0.4}
      />
    </g>
  )
}
