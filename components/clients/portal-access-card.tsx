"use client"

/**
 * PortalAccessCard
 *
 * Shows every client-portal login granted access to this contact/organization
 * and lets a teammate invite a new one, resend an invite, deactivate/
 * reactivate an account, or revoke access to just this entity.
 *
 * Data flow:
 *   GET    /api/portal-users?kind=&entityId=   -> current grants
 *   POST   /api/portal-users/invite            -> invite (or resend, if the
 *                                                  email already has a grant)
 *   PATCH  /api/portal-users/[id]              -> activate / deactivate
 *   DELETE /api/portal-users/[id]              -> revoke this entity's access
 */
import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { KeyRound, Loader2, Mail, Send, ShieldOff, ShieldCheck, UserX } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface Grant {
  accessId: string
  portalUserId: string
  email: string
  fullName: string | null
  isActive: boolean
  lastLoginAt: string | null
  grantedAt: string
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

interface Props {
  kind: "contact" | "organization"
  entityId: string
  /** Prefills the invite dialog's name field. */
  defaultName?: string | null
}

export function PortalAccessCard({ kind, entityId, defaultName }: Props) {
  const { toast } = useToast()
  const { data, isLoading, mutate } = useSWR<{ grants: Grant[] }>(
    `/api/portal-users?kind=${kind}&entityId=${entityId}`,
    fetcher,
    { revalidateOnFocus: false },
  )

  const [inviteOpen, setInviteOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<Grant | null>(null)

  async function handleToggleActive(grant: Grant) {
    setBusyId(grant.portalUserId)
    try {
      const res = await fetch(`/api/portal-users/${grant.portalUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !grant.isActive }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      toast({
        title: grant.isActive ? "Portal access deactivated" : "Portal access reactivated",
        description: grant.email,
      })
      await mutate()
    } catch (err) {
      toast({
        title: "Couldn't update access",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  async function handleRevoke() {
    if (!revoking) return
    setBusyId(revoking.portalUserId)
    try {
      const url = new URL(`/api/portal-users/${revoking.portalUserId}`, window.location.origin)
      url.searchParams.set("kind", kind)
      url.searchParams.set("entityId", entityId)
      const res = await fetch(url.toString(), { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      toast({ title: "Portal access removed", description: revoking.email })
      setRevoking(null)
      await mutate()
    } catch (err) {
      toast({
        title: "Couldn't remove access",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  const grants = data?.grants ?? []

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            Client Portal Access
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            People who can sign in to hub.motta.cpa/client-portal for this {kind === "organization" ? "organization" : "contact"}.
          </p>
        </div>
        <InviteDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          kind={kind}
          entityId={entityId}
          defaultName={defaultName}
          onInvited={() => {
            setInviteOpen(false)
            void mutate()
          }}
        />
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading portal access…
          </div>
        ) : grants.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No one has portal access yet.</p>
        ) : (
          grants.map((grant) => (
            <div
              key={grant.accessId}
              className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{grant.fullName || grant.email}</p>
                    <Badge
                      variant={grant.isActive ? "outline" : "secondary"}
                      className={grant.isActive ? "h-5 text-[10px] text-emerald-700 border-emerald-300" : "h-5 text-[10px]"}
                    >
                      {grant.isActive ? "Active" : "Deactivated"}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{grant.email}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {grant.lastLoginAt
                      ? `Last signed in ${new Date(grant.lastLoginAt).toLocaleDateString()}`
                      : "Never signed in"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 sm:pl-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={busyId === grant.portalUserId}
                  onClick={() => handleToggleActive(grant)}
                >
                  {busyId === grant.portalUserId ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : grant.isActive ? (
                    <>
                      <ShieldOff className="mr-1 h-3.5 w-3.5" />
                      Deactivate
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                      Reactivate
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground hover:text-destructive"
                  disabled={busyId === grant.portalUserId}
                  onClick={() => setRevoking(grant)}
                >
                  <UserX className="mr-1 h-3.5 w-3.5" />
                  Remove
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      <AlertDialog open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove portal access?</AlertDialogTitle>
            <AlertDialogDescription>
              {revoking?.email} will no longer be able to view this {kind === "organization" ? "organization's" : "contact's"} records in
              the client portal. If they have access to other clients, their account stays active for those.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevoke} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ────────────────────── Invite dialog ──────────────────────
function InviteDialog({
  open,
  onOpenChange,
  kind,
  entityId,
  defaultName,
  onInvited,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: "contact" | "organization"
  entityId: string
  defaultName?: string | null
  onInvited: () => void
}) {
  const { toast } = useToast()
  const [email, setEmail] = useState("")
  const [fullName, setFullName] = useState(defaultName ?? "")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch("/api/portal-users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, entityId, email, fullName: fullName || null }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      toast({ title: "Invite sent", description: `${email} can now set a password and sign in.` })
      setEmail("")
      setFullName(defaultName ?? "")
      onInvited()
    } catch (err) {
      toast({
        title: "Couldn't send invite",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 text-xs">
          <Send className="mr-1.5 h-3.5 w-3.5" />
          Invite to Portal
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite to Client Portal</DialogTitle>
          <DialogDescription>
            Sends a branded email with a link to set a password and sign in at the client portal. If this email already has portal
            access, we'll just grant it access to this record and re-send the link.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="portal-invite-name">Full name</Label>
            <Input
              id="portal-invite-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="portal-invite-email">Email address</Label>
            <Input
              id="portal-invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@example.com"
              disabled={submitting}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting || !email}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                "Send Invite"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
