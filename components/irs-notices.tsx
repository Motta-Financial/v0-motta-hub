"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

export function IrsNotices() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">IRS Notices</h1>
          <p className="text-muted-foreground">Track and respond to IRS notices and correspondence</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Notice
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Notices</CardTitle>
          <CardDescription>Manage IRS notices and required responses</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            IRS notices tracking coming soon...
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
