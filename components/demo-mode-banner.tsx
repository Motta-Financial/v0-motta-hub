"use client"

import { useDemoMode, DEMO_TEAM_MEMBERS } from "@/contexts/demo-mode-context"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Eye, User } from "lucide-react"

export function DemoModeBanner() {
  const { isDemoMode, toggleDemoMode, selectedUser, setSelectedUser } = useDemoMode()

  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-200 px-4 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={isDemoMode}
              onCheckedChange={toggleDemoMode}
              className="data-[state=checked]:bg-amber-500"
            />
            <span className="text-sm font-medium text-amber-900">Demo Mode</span>
          </div>
          {isDemoMode && (
            <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">
              <Eye className="h-3 w-3 mr-1" />
              Preview Active
            </Badge>
          )}
        </div>

        {isDemoMode && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-amber-800">
              <User className="h-4 w-4" />
              <span>Viewing as:</span>
            </div>
            <Select
              value={selectedUser?.id || ""}
              onValueChange={(id) => {
                const user = DEMO_TEAM_MEMBERS.find((u) => u.id === id)
                if (user) setSelectedUser(user)
              }}
            >
              <SelectTrigger className="w-[200px] bg-white border-amber-300">
                <SelectValue placeholder="Select user" />
              </SelectTrigger>
              <SelectContent>
                {DEMO_TEAM_MEMBERS.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    <div className="flex flex-col">
                      <span className="font-medium">{user.name}</span>
                      <span className="text-xs text-muted-foreground">{user.role}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!isDemoMode && (
          <p className="text-xs text-amber-700">
            Enable demo mode to preview the app with sample data for any team member
          </p>
        )}
      </div>
    </div>
  )
}
