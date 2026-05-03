"use client"

import { useEffect, useState } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { useUser } from "@/hooks/use-user"
import { Bell, Mail, Loader2, Save } from "lucide-react"

type Pref = {
  category: string
  label: string
  description: string
  email_enabled: boolean
  in_app_enabled: boolean
}

export default function NotificationPreferencesPage() {
  const { teamMember, isLoading: userLoading } = useUser()
  const { toast } = useToast()

  const [prefs, setPrefs] = useState<Pref[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!teamMember?.id) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/notifications/preferences?team_member_id=${teamMember.id}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        if (json.error) throw new Error(json.error)
        setPrefs(json.preferences || [])
      })
      .catch((err) => {
        toast({
          title: "Failed to load preferences",
          description: err.message,
          variant: "destructive",
        })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [teamMember?.id, toast])

  const updatePref = (category: string, field: "email_enabled" | "in_app_enabled", value: boolean) => {
    setPrefs((prev) => prev.map((p) => (p.category === category ? { ...p, [field]: value } : p)))
    setDirty(true)
  }

  const handleSave = async () => {
    if (!teamMember?.id) return
    setSaving(true)
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_member_id: teamMember.id,
          preferences: prefs.map(({ category, email_enabled, in_app_enabled }) => ({
            category,
            email_enabled,
            in_app_enabled,
          })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Save failed")
      toast({ title: "Preferences saved", description: `Updated ${json.updated} categories.` })
      setDirty(false)
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const allEmailOn = prefs.length > 0 && prefs.every((p) => p.email_enabled)
  const toggleAllEmails = (value: boolean) => {
    setPrefs((prev) => prev.map((p) => ({ ...p, email_enabled: value })))
    setDirty(true)
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notification Preferences</h1>
          <p className="mt-1 text-sm text-gray-500">
            Choose which notifications you receive in MOTTA HUB and via email. In-app notifications still appear in
            your bell menu even when email is disabled.
          </p>
        </div>

        {userLoading || loading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Master toggle */}
            <Card className="border-[#8E9B79]/30 bg-[#EAE6E1]/40">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-gray-900">Email notifications</p>
                    <p className="text-sm text-gray-500">
                      Master switch for all email categories. Use the table below for fine-grained control.
                    </p>
                  </div>
                  <Switch
                    checked={allEmailOn}
                    onCheckedChange={toggleAllEmails}
                    aria-label="Toggle all email notifications"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Per-category preferences */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5 text-[#6B745D]" />
                  Notification Categories
                </CardTitle>
                <CardDescription>
                  Toggle each category independently for in-app and email delivery.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="hidden md:grid md:grid-cols-[1fr_120px_120px] gap-4 px-6 py-3 border-b text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <div>Category</div>
                  <div className="text-center">In-App</div>
                  <div className="text-center">Email</div>
                </div>
                <ul className="divide-y">
                  {prefs.map((p) => (
                    <li
                      key={p.category}
                      className="grid grid-cols-1 md:grid-cols-[1fr_120px_120px] gap-4 items-center px-6 py-4"
                    >
                      <div className="min-w-0">
                        <Label className="font-medium text-gray-900">{p.label}</Label>
                        <p className="text-sm text-gray-500 mt-0.5">{p.description}</p>
                      </div>
                      <div className="flex items-center md:justify-center gap-2">
                        <Bell className="md:hidden h-4 w-4 text-gray-400" aria-hidden="true" />
                        <Switch
                          checked={p.in_app_enabled}
                          onCheckedChange={(v) => updatePref(p.category, "in_app_enabled", v)}
                          aria-label={`In-app notifications for ${p.label}`}
                        />
                      </div>
                      <div className="flex items-center md:justify-center gap-2">
                        <Mail className="md:hidden h-4 w-4 text-gray-400" aria-hidden="true" />
                        <Switch
                          checked={p.email_enabled}
                          onCheckedChange={(v) => updatePref(p.category, "email_enabled", v)}
                          aria-label={`Email notifications for ${p.label}`}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <div className="flex items-center justify-end gap-3">
              {dirty && <span className="text-sm text-gray-500">You have unsaved changes</span>}
              <Button
                onClick={handleSave}
                disabled={!dirty || saving}
                className="bg-[#6B745D] hover:bg-[#5a6350] text-white"
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Preferences
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
