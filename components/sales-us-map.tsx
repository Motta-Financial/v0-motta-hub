"use client"

import { useState, useMemo, useCallback } from "react"
import Link from "next/link"
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps"
import { scaleQuantile } from "d3-scale"
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
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

// US topology JSON from unpkg
const geoUrl = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"

// State FIPS to abbreviation mapping
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

const STATE_NAMES: Record<string, string> = {
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

export interface StateData {
  state: string
  proposalCount: number
  acceptedValue: number
  totalValue: number
  clients: Array<{
    name: string
    id: string | null
    kind: "organization" | "contact" | null
    value: number
  }>
}

interface SalesUSMapProps {
  data: StateData[]
  loading?: boolean
}

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

export function SalesUSMap({ data, loading }: SalesUSMapProps) {
  const [hoveredState, setHoveredState] = useState<string | null>(null)
  const [selectedState, setSelectedState] = useState<StateData | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState<[number, number]>([-96, 38])

  // Build lookup from state abbreviation to data
  const stateDataMap = useMemo(() => {
    const map = new Map<string, StateData>()
    for (const d of data) {
      map.set(d.state, d)
    }
    return map
  }, [data])

  // Color scale based on accepted revenue
  const colorScale = useMemo(() => {
    const values = data.map((d) => d.acceptedValue).filter((v) => v > 0)
    if (values.length === 0) return () => "#E7E2DA"

    return scaleQuantile<string>()
      .domain(values)
      .range([
        "#E5E1DB", // lightest warm stone
        "#C9D4C1", // light sage
        "#8FBC8F", // medium sage
        "#5A8A5A", // emerald-ish
        "#3F7D58", // Motta emerald
      ])
  }, [data])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent, stateAbbr: string) => {
      setHoveredState(stateAbbr)
      setTooltipPos({ x: e.clientX, y: e.clientY })
    },
    [],
  )

  const handleStateClick = useCallback(
    (stateAbbr: string) => {
      const stateData = stateDataMap.get(stateAbbr)
      if (stateData) {
        setSelectedState(stateData)
      }
    },
    [stateDataMap],
  )

  const hoveredData = hoveredState ? stateDataMap.get(hoveredState) : null

  return (
    <Card className="border-stone-200 overflow-hidden relative">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-sm font-medium text-stone-700 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-emerald-600" />
            Sales by State
          </CardTitle>
          <p className="text-xs text-stone-500 mt-0.5">
            Click a state to view clients
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom((z) => Math.min(z * 1.5, 4))}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom((z) => Math.max(z / 1.5, 1))}
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
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0 relative">
        <div className="relative h-[380px] bg-gradient-to-b from-stone-900 via-stone-800 to-stone-900 rounded-b-lg overflow-hidden">
          {/* Futuristic grid overlay */}
          <div
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
              `,
              backgroundSize: "40px 40px",
            }}
          />

          {/* Glow effect for high-revenue states */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl" />
            <div className="absolute bottom-1/3 right-1/3 w-40 h-40 bg-emerald-500/5 rounded-full blur-3xl" />
          </div>

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
              <Geographies geography={geoUrl}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const fips = geo.id
                    const stateAbbr = FIPS_TO_ABBR[fips]
                    if (!stateAbbr) return null

                    const stateData = stateDataMap.get(stateAbbr)
                    const isHovered = hoveredState === stateAbbr
                    const isSelected = selectedState?.state === stateAbbr
                    const hasData = stateData && stateData.acceptedValue > 0

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        onMouseMove={(e) => handleMouseMove(e, stateAbbr)}
                        onMouseLeave={() => setHoveredState(null)}
                        onClick={() => handleStateClick(stateAbbr)}
                        style={{
                          default: {
                            fill: hasData
                              ? colorScale(stateData.acceptedValue)
                              : "#3A3A3A",
                            stroke: isSelected ? "#3F7D58" : "#555555",
                            strokeWidth: isSelected ? 2 : 0.5,
                            outline: "none",
                            cursor: hasData ? "pointer" : "default",
                            filter: hasData
                              ? "drop-shadow(0 0 8px rgba(63, 125, 88, 0.3))"
                              : "none",
                            transition: "all 0.2s ease",
                          },
                          hover: {
                            fill: hasData
                              ? "#4ADE80"
                              : "#4A4A4A",
                            stroke: "#3F7D58",
                            strokeWidth: 1.5,
                            outline: "none",
                            cursor: hasData ? "pointer" : "default",
                            filter: "drop-shadow(0 0 12px rgba(74, 222, 128, 0.5))",
                          },
                          pressed: {
                            fill: "#3F7D58",
                            stroke: "#22C55E",
                            strokeWidth: 2,
                            outline: "none",
                          },
                        }}
                      />
                    )
                  })
                }
              </Geographies>
            </ZoomableGroup>
          </ComposableMap>

          {/* Hover tooltip */}
          <AnimatePresence>
            {hoveredState && hoveredData && (
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
                <div className="bg-stone-900/95 backdrop-blur-sm border border-stone-700 rounded-lg px-3 py-2 shadow-xl">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-emerald-400 font-semibold">
                      {STATE_NAMES[hoveredState] || hoveredState}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                    >
                      {hoveredData.proposalCount} proposals
                    </Badge>
                  </div>
                  <div className="text-white font-mono text-lg">
                    {fmtMoney(hoveredData.acceptedValue)}
                  </div>
                  <div className="text-stone-400 text-xs mt-0.5">
                    {hoveredData.clients.length} clients
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Legend */}
          <div className="absolute bottom-3 left-3 bg-stone-900/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-stone-700">
            <div className="text-[10px] text-stone-400 mb-1.5 uppercase tracking-wide">
              Accepted Revenue
            </div>
            <div className="flex items-center gap-1">
              {["#E5E1DB", "#C9D4C1", "#8FBC8F", "#5A8A5A", "#3F7D58"].map(
                (color, i) => (
                  <div
                    key={i}
                    className="w-6 h-3 rounded-sm"
                    style={{ backgroundColor: color }}
                  />
                ),
              )}
            </div>
            <div className="flex justify-between text-[9px] text-stone-500 mt-0.5">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>

          {/* Stats overlay */}
          <div className="absolute top-3 right-3 bg-stone-900/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-stone-700">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-[10px] text-stone-400 uppercase tracking-wide">
                  States
                </div>
                <div className="text-lg font-semibold text-white">
                  {data.filter((d) => d.acceptedValue > 0).length}
                </div>
              </div>
              <div className="w-px h-8 bg-stone-700" />
              <div>
                <div className="text-[10px] text-stone-400 uppercase tracking-wide">
                  Total Revenue
                </div>
                <div className="text-lg font-semibold text-emerald-400">
                  {fmtMoneyCompact(data.reduce((sum, d) => sum + d.acceptedValue, 0))}
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
                    {STATE_NAMES[selectedState.state] || selectedState.state}
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
                      {selectedState.clients.length}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-3">
                <h4 className="text-xs font-medium text-stone-600 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <ChevronRight className="h-3 w-3" />
                  Top Clients
                </h4>
                <ScrollArea className="h-[200px]">
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
                                className="text-sm text-stone-800 hover:text-emerald-700 hover:underline truncate block flex items-center gap-1"
                              >
                                {client.name}
                                <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
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
