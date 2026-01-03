"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CalendarClock, Video, NotebookPen, Headphones } from "lucide-react"
import { CalendlyTab } from "@/components/client-services/calendly-tab"
import { ZoomTab } from "@/components/client-services/zoom-tab"
import { MeetingNotesTab } from "@/components/client-services/meeting-notes-tab"

export function ClientServicesDashboard() {
  const [activeTab, setActiveTab] = useState("calendly")

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 bg-[#6B745D] rounded-xl">
          <Headphones className="h-8 w-8 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Client Services</h1>
          <p className="text-gray-600 mt-1">Manage scheduling, meetings, and client communications</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:inline-grid h-auto p-1 bg-white border">
          <TabsTrigger
            value="calendly"
            className="flex items-center gap-2 py-3 px-6 data-[state=active]:bg-[#6B745D] data-[state=active]:text-white"
          >
            <CalendarClock className="h-4 w-4" />
            <span className="hidden sm:inline">Calendly</span>
          </TabsTrigger>
          <TabsTrigger
            value="zoom"
            className="flex items-center gap-2 py-3 px-6 data-[state=active]:bg-[#6B745D] data-[state=active]:text-white"
          >
            <Video className="h-4 w-4" />
            <span className="hidden sm:inline">Zoom</span>
          </TabsTrigger>
          <TabsTrigger
            value="meeting-notes"
            className="flex items-center gap-2 py-3 px-6 data-[state=active]:bg-[#6B745D] data-[state=active]:text-white"
          >
            <NotebookPen className="h-4 w-4" />
            <span className="hidden sm:inline">Meeting Notes</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calendly" className="mt-6">
          <CalendlyTab />
        </TabsContent>

        <TabsContent value="zoom" className="mt-6">
          <ZoomTab />
        </TabsContent>

        <TabsContent value="meeting-notes" className="mt-6">
          <MeetingNotesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
