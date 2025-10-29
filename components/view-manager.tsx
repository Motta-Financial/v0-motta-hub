"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Save, FolderOpen, Trash2, Share2, Lock } from "lucide-react"
import type { FilterView } from "@/lib/view-types"
import { Badge } from "@/components/ui/badge"

interface ViewManagerProps {
  type: "clients" | "workItems"
  currentFilters: any
  onLoadView: (view: FilterView) => void
  onSaveView?: (viewName: string, isShared: boolean) => void
}

export function ViewManager({ type, currentFilters, onLoadView, onSaveView }: ViewManagerProps) {
  const [views, setViews] = useState<FilterView[]>([])
  const [loading, setLoading] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [loadDialogOpen, setLoadDialogOpen] = useState(false)
  const [viewName, setViewName] = useState("")
  const [isShared, setIsShared] = useState(false)
  const [selectedViewId, setSelectedViewId] = useState<string>("")

  useEffect(() => {
    fetchViews()
  }, [type])

  const fetchViews = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/views?type=${type}`)
      if (!response.ok) throw new Error("Failed to fetch views")
      const data = await response.json()
      setViews(data.views || [])
    } catch (error) {
      console.error("[v0] Error fetching views:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveView = async () => {
    if (!viewName.trim()) return

    try {
      const response = await fetch("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: viewName,
          type,
          filters: currentFilters,
          isShared,
          createdBy: "current-user", // Replace with actual user
        }),
      })

      if (!response.ok) throw new Error("Failed to save view")

      await fetchViews()
      setSaveDialogOpen(false)
      setViewName("")
      setIsShared(false)

      if (onSaveView) {
        onSaveView(viewName, isShared)
      }
    } catch (error) {
      console.error("[v0] Error saving view:", error)
    }
  }

  const handleLoadView = (view: FilterView) => {
    onLoadView(view)
    setLoadDialogOpen(false)
  }

  const handleDeleteView = async (viewId: string) => {
    try {
      const response = await fetch(`/api/views?id=${viewId}`, {
        method: "DELETE",
      })

      if (!response.ok) throw new Error("Failed to delete view")

      await fetchViews()
    } catch (error) {
      console.error("[v0] Error deleting view:", error)
    }
  }

  const handleToggleShare = async (view: FilterView) => {
    try {
      const response = await fetch("/api/views", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: view.id,
          isShared: !view.isShared,
        }),
      })

      if (!response.ok) throw new Error("Failed to update view")

      await fetchViews()
    } catch (error) {
      console.error("[v0] Error updating view:", error)
    }
  }

  const myViews = views.filter((v) => v.createdBy === "current-user")
  const sharedViews = views.filter((v) => v.isShared && v.createdBy !== "current-user")

  return (
    <div className="flex gap-2">
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Save className="h-4 w-4 mr-2" />
            Save View
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Current View</DialogTitle>
            <DialogDescription>Save your current filter settings as a reusable view</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="view-name">View Name</Label>
              <Input
                id="view-name"
                placeholder="e.g., My Active Tax Clients"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="share-view">Share with Firm</Label>
                <p className="text-sm text-muted-foreground">Make this view available to all team members</p>
              </div>
              <Switch id="share-view" checked={isShared} onCheckedChange={setIsShared} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveView} disabled={!viewName.trim()}>
              Save View
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <FolderOpen className="h-4 w-4 mr-2" />
            Load View
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Load Saved View</DialogTitle>
            <DialogDescription>Select a saved view to apply its filters</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[400px] overflow-y-auto">
            {myViews.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2">My Views</h3>
                <div className="space-y-2">
                  {myViews.map((view) => (
                    <div
                      key={view.id}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{view.name}</h4>
                          {view.isShared ? (
                            <Badge variant="secondary" className="text-xs">
                              <Share2 className="h-3 w-3 mr-1" />
                              Shared
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">
                              <Lock className="h-3 w-3 mr-1" />
                              Private
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Last modified: {new Date(view.lastModified).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => handleToggleShare(view)}>
                          {view.isShared ? <Lock className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDeleteView(view.id)}>
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                        <Button size="sm" onClick={() => handleLoadView(view)}>
                          Load
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sharedViews.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2">Firm-Wide Views</h3>
                <div className="space-y-2">
                  {sharedViews.map((view) => (
                    <div
                      key={view.id}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{view.name}</h4>
                          <Badge variant="secondary" className="text-xs">
                            <Share2 className="h-3 w-3 mr-1" />
                            Shared
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Created by: {view.createdBy}</p>
                      </div>
                      <Button size="sm" onClick={() => handleLoadView(view)}>
                        Load
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {views.length === 0 && !loading && (
              <div className="text-center py-8 text-muted-foreground">
                <FolderOpen className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No saved views yet</p>
                <p className="text-sm">Save your current filters to create a view</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
