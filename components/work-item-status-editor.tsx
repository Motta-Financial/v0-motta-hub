"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"
import { Loader2 } from "lucide-react"
import { KARBON_WORK_STATUSES } from "@/lib/karbon-utils"

interface WorkItemStatusEditorProps {
  workItemKey: string
  currentStatus: string
  onStatusUpdated?: () => void
}

export function WorkItemStatusEditor({ workItemKey, currentStatus, onStatusUpdated }: WorkItemStatusEditorProps) {
  const [status, setStatus] = useState(currentStatus)
  const [isUpdating, setIsUpdating] = useState(false)

  const statusOptions = KARBON_WORK_STATUSES

  const handleUpdateStatus = async () => {
    setIsUpdating(true)
    try {
      const response = await fetch(`/api/karbon/work-items/${workItemKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          WorkItemKey: workItemKey,
          PrimaryStatus: status,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to update status")
      }

      toast({
        title: "Status Updated",
        description: `Work item status changed to ${status}`,
      })

      onStatusUpdated?.()
    } catch (error) {
      console.error("[v0] Error updating status:", error)
      toast({
        title: "Error",
        description: "Failed to update work item status",
        variant: "destructive",
      })
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button onClick={handleUpdateStatus} disabled={isUpdating || status === currentStatus} size="sm">
        {isUpdating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Updating...
          </>
        ) : (
          "Update Status"
        )}
      </Button>
    </div>
  )
}
