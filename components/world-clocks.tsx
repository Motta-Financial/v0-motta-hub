"use client"

import { useState, useEffect } from "react"
import { Clock, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface TimeZone {
  id: string
  name: string
  timezone: string
  offset: string
}

const DEFAULT_TIMEZONES: TimeZone[] = [
  { id: "1", name: "New York", timezone: "America/New_York", offset: "EST" },
  { id: "2", name: "London", timezone: "Europe/London", offset: "GMT" },
  { id: "3", name: "Tokyo", timezone: "Asia/Tokyo", offset: "JST" },
]

const AVAILABLE_TIMEZONES: TimeZone[] = [
  { id: "4", name: "Los Angeles", timezone: "America/Los_Angeles", offset: "PST" },
  { id: "5", name: "Chicago", timezone: "America/Chicago", offset: "CST" },
  { id: "6", name: "Denver", timezone: "America/Denver", offset: "MST" },
  { id: "7", name: "Sydney", timezone: "Australia/Sydney", offset: "AEDT" },
  { id: "8", name: "Paris", timezone: "Europe/Paris", offset: "CET" },
  { id: "9", name: "Dubai", timezone: "Asia/Dubai", offset: "GST" },
  { id: "10", name: "Singapore", timezone: "Asia/Singapore", offset: "SGT" },
  { id: "11", name: "Hong Kong", timezone: "Asia/Hong_Kong", offset: "HKT" },
]

export function WorldClocks() {
  const [timezones, setTimezones] = useState<TimeZone[]>(DEFAULT_TIMEZONES)
  const [times, setTimes] = useState<Record<string, string>>({})
  const [showAddTimezone, setShowAddTimezone] = useState(false)

  useEffect(() => {
    const updateTimes = () => {
      const newTimes: Record<string, string> = {}
      timezones.forEach((tz) => {
        const time = new Date().toLocaleTimeString("en-US", {
          timeZone: tz.timezone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
        newTimes[tz.id] = time
      })
      setTimes(newTimes)
    }

    updateTimes()
    const interval = setInterval(updateTimes, 1000)
    return () => clearInterval(interval)
  }, [timezones])

  const addTimezone = (timezone: TimeZone) => {
    if (!timezones.find((tz) => tz.id === timezone.id)) {
      setTimezones([...timezones, timezone])
    }
    setShowAddTimezone(false)
  }

  const removeTimezone = (id: string) => {
    setTimezones(timezones.filter((tz) => tz.id !== id))
  }

  return (
    <div className="flex items-center gap-3">
      {timezones.map((tz) => (
        <div key={tz.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg group relative">
          <Clock className="h-4 w-4 text-gray-500" />
          <div>
            <p className="text-xs text-gray-500">{tz.name}</p>
            <p className="text-sm font-medium text-gray-900">{times[tz.id]}</p>
          </div>
          {timezones.length > 1 && (
            <button
              onClick={() => removeTimezone(tz.id)}
              className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-red-500 text-white rounded-full p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}

      <Popover open={showAddTimezone} onOpenChange={setShowAddTimezone}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-auto py-2 bg-transparent">
            <Plus className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500 px-2 py-1">Add Time Zone</p>
            {AVAILABLE_TIMEZONES.filter((tz) => !timezones.find((t) => t.id === tz.id)).map((tz) => (
              <button
                key={tz.id}
                onClick={() => addTimezone(tz)}
                className="w-full text-left px-2 py-2 hover:bg-gray-100 rounded text-sm transition-colors"
              >
                <span className="font-medium">{tz.name}</span>
                <span className="text-gray-500 ml-2">({tz.offset})</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
