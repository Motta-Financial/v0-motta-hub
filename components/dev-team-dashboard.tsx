"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Code2,
  Clock,
  User,
  GitBranch,
  Key,
  Eye,
  EyeOff,
  Copy,
  Check,
  Link,
  ExternalLink,
  UserPlus,
  Users,
  Plus,
  X,
  MessageSquare,
} from "lucide-react"

type ProjectStatus = "Active" | "In Review" | "Blocked" | "Testing" | "Deployed"

const TEAM_MEMBERS = ["Dat", "Grace"] as const

interface HandoffHistory {
  id: string
  from: string
  to: string
  timestamp: string
  notes: string
  status: ProjectStatus
}

interface NextStep {
  id: string
  text: string
  completed: boolean
  comment?: string
  assignedTo?: string // Added assignedTo field for step assignment
}

interface Project {
  id: string
  name: string
  description: string
  status: ProjectStatus
  currentVersion: string
  nextVersion: string
  versionLink: string
  lastWorkedOn: string
  lastWorkedBy: string
  notes: string
  nextSteps: NextStep[]
  assignedTo: string | null
  inHandoffQueue: boolean
  handoffHistory: HandoffHistory[]
}

interface ApiKey {
  id: string
  name: string
  key: string
  description: string
  addedBy: string
  addedOn: string
}

const initialProjects: Project[] = [
  {
    id: "1",
    name: "Alfred AI",
    description: "AI-powered assistant for automating firm workflows",
    status: "Active",
    currentVersion: "v2.3.1",
    nextVersion: "v2.4.0",
    versionLink: "https://github.com/motta-firm/alfred-ai/releases/v2.3.1",
    lastWorkedOn: "2 hours ago",
    lastWorkedBy: "Dat",
    notes: "API integration is complete. Need to test edge cases with multi-step workflows.",
    nextSteps: [
      {
        id: "1",
        text: "Implement natural language processing for client queries",
        completed: false,
        assignedTo: "Dat", // Added assignment example
      },
      {
        id: "2",
        text: "Test edge cases with multi-step workflows",
        completed: true,
        comment: "Tested with 5 different scenarios, all passed",
        assignedTo: "Dat",
      },
      {
        id: "3",
        text: "Update documentation for new API endpoints",
        completed: false,
        assignedTo: "Grace", // Added assignment example
      },
    ],
    assignedTo: "Dat",
    inHandoffQueue: false,
    handoffHistory: [
      {
        id: "1",
        from: "Grace",
        to: "Dat",
        timestamp: "2025-01-20 14:30",
        notes: "Completed API integration, ready for NLP implementation",
        status: "Active",
      },
    ],
  },
  {
    id: "2",
    name: "SHIN",
    description: "Smart Hub for Internal Notifications",
    status: "Testing",
    currentVersion: "v1.5.2",
    nextVersion: "v1.6.0",
    versionLink: "https://github.com/motta-firm/shin/releases/v1.5.2",
    lastWorkedOn: "5 hours ago",
    lastWorkedBy: "Grace",
    notes: "Desktop notifications working perfectly. Mobile push needs debugging - check Firebase config.",
    nextSteps: [
      {
        id: "1",
        text: "Fix notification delivery delays for mobile devices",
        completed: false,
        comment: "Issue seems to be with Firebase config - checking credentials",
      },
      {
        id: "2",
        text: "Test on iOS and Android devices",
        completed: false,
        assignedTo: "Grace", // Added assignment example
      },
      {
        id: "3",
        text: "Update Firebase configuration",
        completed: false,
      },
    ],
    assignedTo: null,
    inHandoffQueue: true,
    handoffHistory: [],
  },
  {
    id: "3",
    name: "Motta Hub Nexus",
    description: "Central dashboard for all firm operations",
    status: "Active",
    currentVersion: "v3.1.0",
    nextVersion: "v3.2.0",
    versionLink: "https://github.com/motta-firm/nexus/releases/v3.1.0",
    lastWorkedOn: "1 hour ago",
    lastWorkedBy: "Dat",
    notes: "Dashboard layout is finalized. Ready to integrate tax return tracking API endpoints.",
    nextSteps: [
      {
        id: "1",
        text: "Add busy season tracker integration with real-time updates",
        completed: false,
      },
      {
        id: "2",
        text: "Create API endpoints for tax return data",
        completed: false,
      },
      {
        id: "3",
        text: "Test real-time sync functionality",
        completed: false,
      },
    ],
    assignedTo: "Dat",
    inHandoffQueue: false,
    handoffHistory: [],
  },
  {
    id: "4",
    name: "G Plus",
    description: "Enhanced Google Workspace integration suite",
    status: "In Review",
    currentVersion: "v1.2.0",
    nextVersion: "v1.3.0",
    versionLink: "https://github.com/motta-firm/g-plus/releases/v1.2.0",
    lastWorkedOn: "1 day ago",
    lastWorkedBy: "Grace",
    notes: "All features implemented. Waiting on security team approval for OAuth scopes.",
    nextSteps: [
      {
        id: "1",
        text: "Code review and security audit before deployment",
        completed: true,
      },
      {
        id: "2",
        text: "Update OAuth scopes documentation",
        completed: false,
      },
    ],
    assignedTo: "Grace",
    inHandoffQueue: false,
    handoffHistory: [],
  },
]

const initialApiKeys: ApiKey[] = [
  {
    id: "1",
    name: "OpenAI API Key",
    key: "sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz",
    description: "For Alfred AI natural language processing",
    addedBy: "Dat",
    addedOn: "2025-01-15",
  },
  {
    id: "2",
    name: "Firebase Cloud Messaging",
    key: "AIzaSyB1234567890abcdefghijklmnopqrstuvwxyz",
    description: "For SHIN push notifications",
    addedBy: "Grace",
    addedOn: "2025-01-10",
  },
  {
    id: "3",
    name: "Google Workspace API",
    key: "1234567890-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com",
    description: "For G Plus integration",
    addedBy: "Dat",
    addedOn: "2025-01-08",
  },
]

const statusColors: Record<ProjectStatus, string> = {
  Active: "bg-green-500/10 text-green-500 border-green-500/20",
  "In Review": "bg-blue-500/10 text-blue-500 border-blue-500/20",
  Blocked: "bg-red-500/10 text-red-500 border-red-500/20",
  Testing: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  Deployed: "bg-purple-500/10 text-purple-500 border-purple-500/20",
}

const STORAGE_VERSION = "1.0"
const PROJECTS_STORAGE_KEY = "special-teams-projects-v" + STORAGE_VERSION
const API_KEYS_STORAGE_KEY = "special-teams-api-keys-v" + STORAGE_VERSION

export function DevTeamDashboard() {
  const [projects, setProjects] = useState<Project[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(PROJECTS_STORAGE_KEY)
        if (saved) {
          const parsedProjects = JSON.parse(saved)
          console.log("[v0] Loaded projects from localStorage:", parsedProjects.length, "projects")
          return parsedProjects
        }
      } catch (e) {
        console.error("[v0] Failed to parse saved projects:", e)
      }
    }
    console.log("[v0] Using initial projects")
    return initialProjects
  })

  const [apiKeys, setApiKeys] = useState<ApiKey[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(API_KEYS_STORAGE_KEY)
        if (saved) {
          const parsedKeys = JSON.parse(saved)
          console.log("[v0] Loaded API keys from localStorage:", parsedKeys.length, "keys")
          return parsedKeys
        }
      } catch (e) {
        console.error("[v0] Failed to parse saved API keys:", e)
      }
    }
    console.log("[v0] Using initial API keys")
    return initialApiKeys
  })

  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set())
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [copiedLink, setCopiedLink] = useState<string | null>(null)
  const [handoffTo, setHandoffTo] = useState<string>("")
  const [handoffNote, setHandoffNote] = useState<string>("")
  const [newNextStep, setNewNextStep] = useState<string>("")
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects))
      console.log("[v0] Projects saved to localStorage (version", STORAGE_VERSION, ")")
    }
  }, [projects])

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(apiKeys))
      console.log("[v0] API keys saved to localStorage (version", STORAGE_VERSION, ")")
    }
  }, [apiKeys])

  const toggleKeyVisibility = (keyId: string) => {
    setVisibleKeys((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(keyId)) {
        newSet.delete(keyId)
      } else {
        newSet.add(keyId)
      }
      return newSet
    })
  }

  const copyToClipboard = (key: string, keyId: string) => {
    navigator.clipboard.writeText(key)
    setCopiedKey(keyId)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const copyLinkToClipboard = (link: string, projectId: string) => {
    navigator.clipboard.writeText(link)
    setCopiedLink(projectId)
    setTimeout(() => setCopiedLink(null), 2000)
  }

  const maskKey = (key: string) => {
    if (key.length <= 8) return "••••••••"
    return key.slice(0, 4) + "••••••••" + key.slice(-4)
  }

  const handleUpdateProject = (updatedProject: Project) => {
    console.log("[v0] Saving project changes:", updatedProject)
    setProjects((prev) => prev.map((p) => (p.id === updatedProject.id ? updatedProject : p)))
    setIsEditDialogOpen(false)
    setSelectedProject(null)
  }

  const handleClaimProject = (project: Project, claimedBy: string) => {
    const updatedProject = {
      ...project,
      assignedTo: claimedBy,
      inHandoffQueue: false,
      lastWorkedBy: claimedBy,
      lastWorkedOn: "Just now",
      handoffHistory: [
        ...project.handoffHistory,
        {
          id: Date.now().toString(),
          from: "Handoff Queue",
          to: claimedBy,
          timestamp: new Date().toLocaleString(),
          notes: `Claimed from handoff queue`,
          status: project.status,
        },
      ],
    }
    setProjects((prev) => prev.map((p) => (p.id === project.id ? updatedProject : p)))
    setSelectedProject(updatedProject)
  }

  const handleHandoffProject = () => {
    if (!selectedProject || !handoffTo) return

    const isQueue = handoffTo === "Handoff Queue"
    const updatedProject = {
      ...selectedProject,
      assignedTo: isQueue ? null : handoffTo,
      inHandoffQueue: isQueue,
      lastWorkedBy: selectedProject.assignedTo || selectedProject.lastWorkedBy,
      lastWorkedOn: "Just now",
      handoffHistory: [
        ...selectedProject.handoffHistory,
        {
          id: Date.now().toString(),
          from: selectedProject.assignedTo || "Unassigned",
          to: handoffTo,
          timestamp: new Date().toLocaleString(),
          notes: handoffNote,
          status: selectedProject.status,
        },
      ],
    }
    setProjects((prev) => prev.map((p) => (p.id === updatedProject.id ? updatedProject : p)))
    setSelectedProject(updatedProject)
    setHandoffTo("")
    setHandoffNote("")
  }

  const addNextStep = () => {
    if (!selectedProject || !newNextStep.trim()) return
    setSelectedProject({
      ...selectedProject,
      nextSteps: [
        ...selectedProject.nextSteps,
        {
          id: Date.now().toString(),
          text: newNextStep.trim(),
          completed: false,
        },
      ],
    })
    setNewNextStep("")
  }

  const removeNextStep = (stepId: string) => {
    if (!selectedProject) return
    setSelectedProject({
      ...selectedProject,
      nextSteps: selectedProject.nextSteps.filter((step) => step.id !== stepId),
    })
  }

  const toggleStepCompletion = (stepId: string) => {
    if (!selectedProject) return
    setSelectedProject({
      ...selectedProject,
      nextSteps: selectedProject.nextSteps.map((step) =>
        step.id === stepId ? { ...step, completed: !step.completed } : step,
      ),
    })
  }

  const updateStepComment = (stepId: string, comment: string) => {
    if (!selectedProject) return
    setSelectedProject({
      ...selectedProject,
      nextSteps: selectedProject.nextSteps.map((step) => (step.id === stepId ? { ...step, comment } : step)),
    })
  }

  const toggleCommentExpanded = (stepId: string) => {
    setExpandedComments((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(stepId)) {
        newSet.delete(stepId)
      } else {
        newSet.add(stepId)
      }
      return newSet
    })
  }

  const updateStepAssignment = (stepId: string, assignedTo: string) => {
    if (!selectedProject) return
    setSelectedProject({
      ...selectedProject,
      nextSteps: selectedProject.nextSteps.map((step) =>
        step.id === stepId ? { ...step, assignedTo: assignedTo === "Unassigned" ? undefined : assignedTo } : step,
      ),
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Special Teams Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Development team collaboration hub for tracking projects and shared resources
        </p>
      </div>

      {/* Active Projects */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Active Projects</h2>
          <Badge variant="outline" className="text-sm">
            {projects.length} Projects
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => (
            <Card
              key={project.id}
              className="cursor-pointer transition-all hover:shadow-md hover:border-primary/50"
              onClick={() => {
                setSelectedProject(project)
                setIsEditDialogOpen(true)
              }}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      <Code2 className="h-5 w-5" />
                      {project.name}
                    </CardTitle>
                    <CardDescription>{project.description}</CardDescription>
                  </div>
                  <Badge className={statusColors[project.status]} variant="outline">
                    {project.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {project.inHandoffQueue ? (
                  <div className="flex items-center gap-2 p-2 rounded-md bg-purple-500/10 border border-purple-500/20">
                    <Users className="h-4 w-4 text-purple-500" />
                    <span className="text-sm font-medium text-purple-500">In Handoff Queue</span>
                  </div>
                ) : project.assignedTo ? (
                  <div className="flex items-center gap-2 p-2 rounded-md bg-blue-500/10 border border-blue-500/20">
                    <UserPlus className="h-4 w-4 text-blue-500" />
                    <span className="text-sm font-medium text-blue-500">Assigned to {project.assignedTo}</span>
                  </div>
                ) : null}

                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <GitBranch className="h-4 w-4" />
                    <span className="font-mono">{project.currentVersion}</span>
                    <span>→</span>
                    <span className="font-mono text-foreground">{project.nextVersion}</span>
                  </div>
                </div>

                {project.versionLink && (
                  <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50 border">
                    <Link className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs font-mono text-muted-foreground truncate flex-1">
                      {project.versionLink}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation()
                          copyLinkToClipboard(project.versionLink, project.id)
                        }}
                      >
                        {copiedLink === project.id ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation()
                          window.open(project.versionLink, "_blank")
                        }}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span>{project.lastWorkedBy}</span>
                  <span>•</span>
                  <Clock className="h-4 w-4" />
                  <span>{project.lastWorkedOn}</span>
                </div>

                <div className="pt-2 border-t">
                  <p className="text-sm font-medium mb-2">Next Steps:</p>
                  <ul className="space-y-1">
                    {project.nextSteps
                      .filter((step) => !step.completed)
                      .slice(0, 2)
                      .map((step) => (
                        <li key={step.id} className="text-sm text-muted-foreground flex items-start gap-2">
                          <span className="text-primary mt-0.5">•</span>
                          <span className="line-clamp-1">{step.text}</span>
                        </li>
                      ))}
                    {project.nextSteps.filter((step) => !step.completed).length > 2 && (
                      <li className="text-sm text-muted-foreground">
                        +{project.nextSteps.filter((step) => !step.completed).length - 2} more...
                      </li>
                    )}
                    {project.nextSteps.filter((step) => !step.completed).length === 0 && (
                      <li className="text-sm text-muted-foreground italic">All steps completed!</li>
                    )}
                  </ul>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* API Keys Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Shared API Keys
              </CardTitle>
              <CardDescription>Securely stored API keys accessible to the team</CardDescription>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm">Add API Key</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New API Key</DialogTitle>
                  <DialogDescription>Add a new API key for team access</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="keyName">Key Name</Label>
                    <Input id="keyName" placeholder="e.g., OpenAI API Key" />
                  </div>
                  <div>
                    <Label htmlFor="keyValue">API Key</Label>
                    <Input id="keyValue" type="password" placeholder="Enter API key" />
                  </div>
                  <div>
                    <Label htmlFor="keyDescription">Description</Label>
                    <Textarea id="keyDescription" placeholder="What is this key used for?" />
                  </div>
                  <Button className="w-full">Add Key</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {apiKeys.map((apiKey) => (
              <div key={apiKey.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{apiKey.name}</p>
                    <Badge variant="secondary" className="text-xs">
                      {apiKey.addedBy}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{apiKey.description}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {visibleKeys.has(apiKey.id) ? apiKey.key : maskKey(apiKey.key)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => toggleKeyVisibility(apiKey.id)}>
                    {visibleKeys.has(apiKey.id) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => copyToClipboard(apiKey.key, apiKey.id)}>
                    {copiedKey === apiKey.id ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Edit Project Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedProject?.name}</DialogTitle>
            <DialogDescription>{selectedProject?.description}</DialogDescription>
          </DialogHeader>
          {selectedProject && (
            <div className="space-y-4">
              {selectedProject.inHandoffQueue && (
                <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/20 space-y-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-purple-500" />
                    <p className="font-medium text-purple-500">This project is in the handoff queue</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Claim this project to assign it to yourself and start working on it.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 bg-transparent"
                      onClick={() => handleClaimProject(selectedProject, "Dat")}
                    >
                      Claim as Dat
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 bg-transparent"
                      onClick={() => handleClaimProject(selectedProject, "Grace")}
                    >
                      Claim as Grace
                    </Button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={selectedProject.status}
                    onValueChange={(value) =>
                      setSelectedProject({ ...selectedProject, status: value as ProjectStatus })
                    }
                  >
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="In Review">In Review</SelectItem>
                      <SelectItem value="Blocked">Blocked</SelectItem>
                      <SelectItem value="Testing">Testing</SelectItem>
                      <SelectItem value="Deployed">Deployed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="lastWorkedBy">Last Worked By</Label>
                  <Select
                    value={selectedProject.lastWorkedBy}
                    onValueChange={(value) => setSelectedProject({ ...selectedProject, lastWorkedBy: value })}
                  >
                    <SelectTrigger id="lastWorkedBy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEAM_MEMBERS.map((member) => (
                        <SelectItem key={member} value={member}>
                          {member}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="currentVersion">Current Version</Label>
                  <Input
                    id="currentVersion"
                    value={selectedProject.currentVersion}
                    onChange={(e) => setSelectedProject({ ...selectedProject, currentVersion: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="nextVersion">Next Version</Label>
                  <Input
                    id="nextVersion"
                    value={selectedProject.nextVersion}
                    onChange={(e) => setSelectedProject({ ...selectedProject, nextVersion: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="versionLink">Version Link</Label>
                <Input
                  id="versionLink"
                  type="url"
                  placeholder="https://github.com/your-repo/releases/v1.0.0"
                  value={selectedProject.versionLink}
                  onChange={(e) => setSelectedProject({ ...selectedProject, versionLink: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Link to the current version (GitHub release, deployment URL, etc.)
                </p>
              </div>

              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={selectedProject.notes}
                  onChange={(e) => setSelectedProject({ ...selectedProject, notes: e.target.value })}
                  rows={3}
                  placeholder="General notes and ideas for this project..."
                />
              </div>

              <div>
                <Label>Next Steps</Label>
                <div className="space-y-2 mt-2">
                  {selectedProject.nextSteps.map((step) => (
                    <div key={step.id} className="space-y-2">
                      <div className="flex items-start gap-2 p-2 rounded-md border bg-card">
                        <Checkbox
                          checked={step.completed}
                          onCheckedChange={() => toggleStepCompletion(step.id)}
                          className="mt-1"
                        />
                        <div className="flex-1 space-y-1">
                          <span
                            className={`block text-sm ${step.completed ? "line-through text-muted-foreground" : ""}`}
                          >
                            {step.text}
                          </span>
                          <Select
                            value={step.assignedTo || "Unassigned"}
                            onValueChange={(value) => updateStepAssignment(step.id, value)}
                          >
                            <SelectTrigger className="h-7 text-xs w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Unassigned">Unassigned</SelectItem>
                              <SelectItem value="Dat">Dat</SelectItem>
                              <SelectItem value="Grace">Grace</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 flex-shrink-0"
                          onClick={() => toggleCommentExpanded(step.id)}
                        >
                          <MessageSquare className={`h-3 w-3 ${step.comment ? "text-primary" : ""}`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 flex-shrink-0"
                          onClick={() => removeNextStep(step.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      {expandedComments.has(step.id) && (
                        <div className="ml-8 mr-8">
                          <Textarea
                            placeholder="Add a comment for this step..."
                            value={step.comment || ""}
                            onChange={(e) => updateStepComment(step.id, e.target.value)}
                            rows={2}
                            className="text-sm"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add a next step..."
                      value={newNextStep}
                      onChange={(e) => setNewNextStep(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          addNextStep()
                        }
                      }}
                    />
                    <Button onClick={addNextStep} size="icon" disabled={!newNextStep.trim()}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg border bg-muted/50 space-y-3">
                <div className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5" />
                  <h3 className="font-semibold">Handoff Project</h3>
                </div>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="handoffTo">Handoff To</Label>
                    <Select value={handoffTo} onValueChange={setHandoffTo}>
                      <SelectTrigger id="handoffTo">
                        <SelectValue placeholder="Select team member or queue" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Dat">Dat</SelectItem>
                        <SelectItem value="Grace">Grace</SelectItem>
                        <SelectItem value="Handoff Queue">Handoff Queue</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="handoffNote">Handoff Note</Label>
                    <Textarea
                      id="handoffNote"
                      value={handoffNote}
                      onChange={(e) => setHandoffNote(e.target.value)}
                      placeholder="Add a note for the next person..."
                      rows={2}
                    />
                  </div>
                  <Button onClick={handleHandoffProject} disabled={!handoffTo} className="w-full">
                    Handoff Project
                  </Button>
                </div>
              </div>

              {selectedProject.handoffHistory.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm">Handoff History</h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {selectedProject.handoffHistory.map((handoff) => (
                      <div key={handoff.id} className="p-3 rounded-lg border bg-card text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{handoff.from}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-medium">{handoff.to}</span>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {handoff.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">{handoff.timestamp}</p>
                        {handoff.notes && <p className="text-sm text-muted-foreground">{handoff.notes}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => handleUpdateProject(selectedProject)}>Save Changes</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
