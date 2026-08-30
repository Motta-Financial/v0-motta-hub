"use client"

import { useState } from "react"
import { ChevronDown, Video } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { MeetingCard } from "@/components/portal/meeting-card"
import { MOCK_MEETINGS } from "@/lib/mock/meetings"

const RECENT_COUNT = 3

export default function MeetingsPage() {
  const [showEarlier, setShowEarlier] = useState(false)

  const recentMeetings = MOCK_MEETINGS.slice(0, RECENT_COUNT)
  const earlierMeetings = MOCK_MEETINGS.slice(RECENT_COUNT)

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Video className="h-6 w-6" style={{ color: "#6B745D" }} />
          Meetings
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          A record of your past meetings with our team, including recaps and
          action items.
        </p>
      </div>

      {recentMeetings.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Video className="h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-500">No meetings on file yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {recentMeetings.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} />
          ))}
        </div>
      )}

      {earlierMeetings.length > 0 && (
        <Collapsible open={showEarlier} onOpenChange={setShowEarlier}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  showEarlier ? "rotate-180" : ""
                }`}
              />
              {showEarlier
                ? "Hide earlier meetings"
                : `Show earlier meetings (${earlierMeetings.length})`}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-1">
            {earlierMeetings.map((meeting) => (
              <MeetingCard key={meeting.id} meeting={meeting} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
