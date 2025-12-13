"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

export function TaxAdvisory() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tax Advisory</h1>
          <p className="text-muted-foreground">Ad-hoc tax advisory services and consultations</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New Advisory Request
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Advisory Requests</CardTitle>
          <CardDescription>Track ad-hoc tax advisory consultations and requests</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            Advisory tracking coming soon...
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
