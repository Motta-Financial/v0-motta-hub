"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Code2,
  GitBranch,
  ExternalLink,
  Copy,
  Eye,
  EyeOff,
  Plus,
  Clock,
  User,
  Key,
} from "lucide-react"

interface Project {
  id: string
  name: string
  description: string
  status: "Active" | "Testing" | "In Review" | "Paused"
  assignedTo: string
  assignmentColor: string
  currentVersion: string
  nextVersion: string
  githubUrl: string
  lastUpdatedBy: string
  lastUpdatedAt: string
  nextSteps: string[]
}

interface ApiKey {
  id: string
  name: string
  description: string
  addedBy: string
  maskedKey: string
  fullKey: string
}

const MOCK_PROJECTS: Project[] = []

const MOCK_API_KEYS: ApiKey[] = []

const getStatusColor = (status: Project["status"]) => {
  switch (status) {
    case "Active":
      return "bg-green-100 text-green-700 border-green-200"
    case "Testing":
      return "bg-yellow-100 text-yellow-700 border-yellow-200"
    case "In Review":
      return "bg-blue-100 text-blue-700 border-blue-200"
    case "Paused":
      return "bg-gray-100 text-gray-700 border-gray-200"
    default:
      return "bg-gray-100 text-gray-700 border-gray-200"
  }
}

function ProjectCard({ project }: { project: Project }) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Code2 className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">{project.name}</CardTitle>
          </div>
          <Badge variant="outline" className={getStatusColor(project.status)}>
            {project.status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{project.description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Assigned To */}
        <div className={`flex items-center gap-2 px-3 py-2 rounded-md ${project.assignmentColor}`}>
          <User className="h-4 w-4" />
          <span className="text-sm font-medium">Assigned to {project.assignedTo}</span>
        </div>

        {/* Version Info */}
        <div className="flex items-center gap-2 text-sm">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">{project.currentVersion}</span>
          <span className="text-muted-foreground">→</span>
          <span className="font-medium">{project.nextVersion}</span>
        </div>

        {/* GitHub URL */}
        <div className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-2">
          <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground truncate flex-1 font-mono">
            {project.githubUrl}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => copyToClipboard(project.githubUrl)}
          >
            <Copy className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" asChild>
            <a href={project.githubUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        </div>

        {/* Last Updated */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <User className="h-3 w-3" />
          <span>{project.lastUpdatedBy}</span>
          <span>•</span>
          <Clock className="h-3 w-3" />
          <span>{project.lastUpdatedAt}</span>
        </div>

        {/* Next Steps */}
        <div>
          <h4 className="text-sm font-semibold mb-2">Next Steps:</h4>
          <ul className="space-y-1">
            {project.nextSteps.slice(0, 2).map((step, index) => (
              <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-current shrink-0" />
                {step}
              </li>
            ))}
            {project.nextSteps.length > 2 && (
              <li className="text-sm text-blue-600">+{project.nextSteps.length - 2} more...</li>
            )}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

function ApiKeyRow({ apiKey }: { apiKey: ApiKey }) {
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyToClipboard = () => {
    navigator.clipboard.writeText(apiKey.fullKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold">{apiKey.name}</h4>
          <Badge variant="secondary" className="text-xs">
            {apiKey.addedBy}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{apiKey.description}</p>
        <p className="text-sm font-mono text-muted-foreground">
          {showKey ? apiKey.fullKey : apiKey.maskedKey}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => setShowKey(!showKey)}>
          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={copyToClipboard}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export function SpecialTeamsDashboard() {
  const [projects] = useState<Project[]>(MOCK_PROJECTS)
  const [apiKeys] = useState<ApiKey[]>(MOCK_API_KEYS)

  const activeProjects = projects.filter((p) => p.status === "Active" || p.status === "Testing")

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Special Teams Dashboard</h1>
        <p className="text-muted-foreground">
          Development team collaboration hub for tracking projects and shared resources
        </p>
      </div>

      {/* Active Projects */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Active Projects</h2>
          <span className="text-sm text-muted-foreground">{projects.length} Projects</span>
        </div>
        {projects.length === 0 ? (
          <Card className="p-8 text-center">
            <Code2 className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No projects yet. Add a project to get started.</p>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>

      {/* Shared API Keys */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle>Shared API Keys</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Securely stored API keys accessible to the team
                </p>
              </div>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Add API Key
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New API Key</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Key Name</label>
                    <Input placeholder="e.g., Stripe API Key" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Description</label>
                    <Input placeholder="e.g., For payment processing" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">API Key</label>
                    <Input type="password" placeholder="Enter the API key" />
                  </div>
                  <Button className="w-full">Save API Key</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {apiKeys.length === 0 ? (
            <div className="text-center py-6">
              <Key className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No API keys stored yet. Add one to get started.</p>
            </div>
          ) : (
            apiKeys.map((apiKey) => (
              <ApiKeyRow key={apiKey.id} apiKey={apiKey} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
