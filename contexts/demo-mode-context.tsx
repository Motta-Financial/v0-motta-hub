"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"

// Demo team members mapped from actual Supabase data
export const DEMO_TEAM_MEMBERS = [
  {
    id: "21969201-a354-4f43-b4e8-0a348c0ecb27",
    name: "Dat Le",
    email: "dat.le@mottafinancial.com",
    role: "Tax Manager",
    avatar: "/professional-asian-man.png",
  },
  {
    id: "910afa82-3f61-4f6f-a9a6-ceec31f0c691",
    name: "Matthew Pereira",
    email: "matthew.pereira@mottafinancial.com",
    role: "Senior Accountant",
    avatar: "/professional-man-glasses.png",
  },
  {
    id: "b1945d12-8e60-4489-8f1a-4c5a55c802c0",
    name: "Andrew Gianares",
    email: "andrew.gianares@mottafinancial.com",
    role: "Partner",
    avatar: "/professional-man.png",
  },
  {
    id: "40a51c30-5071-4f97-9038-ecfea2c6025a",
    name: "Ganesh Vasan",
    email: "ganesh.vasan@mottafinancial.com",
    role: "International Tax Specialist",
    avatar: "/placeholder.svg",
  },
  {
    id: "503705e4-25ee-4fc5-8c02-33005737be57",
    name: "Mark Dwyer",
    email: "mark.dwyer@mottafinancial.com",
    role: "Wealth Manager",
    avatar: "/professional-man-beard.png",
  },
  {
    id: "a3f79097-7c44-452d-9fdb-4ea6610f47f0",
    name: "Grace Cha",
    email: "grace.cha@mottafinancial.com",
    role: "Tax Associate",
    avatar: "/placeholder.svg",
  },
  {
    id: "c10d7f57-3f82-4674-81ec-b805beb004a9",
    name: "Thameem JA",
    email: "thameem.ja@mottafinancial.com",
    role: "Tax Analyst",
    avatar: "/placeholder.svg",
  },
  {
    id: "74120a69-fce8-41fe-91a7-3b55da6791e5",
    name: "Samprina Zekio",
    email: "samprina.zekio@mottafinancial.com",
    role: "Administrative Assistant",
    avatar: "/placeholder.svg",
  },
]

// Demo statistics that change based on user
export const getDemoStats = (userId: string) => {
  const baseStats = {
    activeClients: 247,
    openTasks: 18,
    tasksToday: 3,
    upcomingDeadlines: 7,
    criticalDeadlines: 2,
    pendingDocuments: 12,
    unreadNotifications: 5,
  }

  // Vary stats slightly per user for realism
  const hash = userId.charCodeAt(0) % 10
  return {
    ...baseStats,
    openTasks: baseStats.openTasks + hash,
    tasksToday: Math.max(1, baseStats.tasksToday + (hash % 3)),
    unreadNotifications: Math.max(2, baseStats.unreadNotifications + (hash % 4)),
  }
}

// Demo tasks for each user
export const getDemoTasks = (userId: string) => {
  const allTasks = [
    {
      id: "1",
      title: "Research DAF options for Johnson family",
      description: "Compare Fidelity Charitable, Schwab Charitable, and Vanguard Charitable",
      status: "todo",
      priority: "high",
      dueDate: "2026-01-10",
      assigneeId: "a3f79097-7c44-452d-9fdb-4ea6610f47f0",
      client: "Johnson Family Trust",
    },
    {
      id: "2",
      title: "Set up AP aging report for ABC Corp",
      description: "Configure QuickBooks AP aging report",
      status: "in_progress",
      priority: "medium",
      dueDate: "2026-01-08",
      assigneeId: "b1945d12-8e60-4489-8f1a-4c5a55c802c0",
      client: "ABC Corporation",
    },
    {
      id: "3",
      title: "Prepare cap table summary for TechStart",
      description: "Clean up existing cap table, verify option pool",
      status: "todo",
      priority: "high",
      dueDate: "2026-01-15",
      assigneeId: "910afa82-3f61-4f6f-a9a6-ceec31f0c691",
      client: "TechStart Inc",
    },
    {
      id: "4",
      title: "Draft transfer pricing memo for GlobalTrade",
      description: "Document intercompany transactions",
      status: "todo",
      priority: "high",
      dueDate: "2026-01-20",
      assigneeId: "c10d7f57-3f82-4674-81ec-b805beb004a9",
      client: "GlobalTrade LLC",
    },
    {
      id: "5",
      title: "Send engagement letter to Smith & Associates",
      description: "Prepare and send 2025 tax engagement letter",
      status: "completed",
      priority: "medium",
      dueDate: "2026-01-05",
      assigneeId: "a3f79097-7c44-452d-9fdb-4ea6610f47f0",
      client: "Smith & Associates",
    },
    {
      id: "6",
      title: "Request prior year returns from Smith",
      description: "Email client to request 2023 and 2024 returns",
      status: "in_progress",
      priority: "medium",
      dueDate: "2026-01-07",
      assigneeId: "74120a69-fce8-41fe-91a7-3b55da6791e5",
      client: "Smith & Associates",
    },
    {
      id: "7",
      title: "Review Q4 estimated payments for Martinez",
      description: "Verify Q4 payments and reconcile with projections",
      status: "completed",
      priority: "low",
      dueDate: "2026-01-03",
      assigneeId: "503705e4-25ee-4fc5-8c02-33005737be57",
      client: "Martinez Family Office",
    },
    {
      id: "8",
      title: "Prepare 2025 tax organizer templates",
      description: "Update with 2025 law changes",
      status: "todo",
      priority: "medium",
      dueDate: "2026-01-12",
      assigneeId: "21969201-a354-4f43-b4e8-0a348c0ecb27",
      client: "Internal",
    },
    {
      id: "9",
      title: "Schedule Q1 tax planning meetings",
      description: "Coordinate with top 20 clients",
      status: "todo",
      priority: "high",
      dueDate: "2026-01-14",
      assigneeId: "b1945d12-8e60-4489-8f1a-4c5a55c802c0",
      client: "Multiple",
    },
    {
      id: "10",
      title: "Review GILTI calculations for GlobalTrade",
      description: "Analyze Section 962 election options",
      status: "in_progress",
      priority: "high",
      dueDate: "2026-01-18",
      assigneeId: "40a51c30-5071-4f97-9038-ecfea2c6025a",
      client: "GlobalTrade LLC",
    },
  ]

  return allTasks.filter((task) => task.assigneeId === userId)
}

// Demo notifications for each user
export const getDemoNotifications = (userId: string) => {
  const allNotifications = [
    {
      id: "1",
      title: "New Task Assigned",
      message: "You have been assigned: Research DAF options for Johnson family",
      type: "task",
      isRead: false,
      userId: "a3f79097-7c44-452d-9fdb-4ea6610f47f0",
      createdAt: new Date().toISOString(),
    },
    {
      id: "2",
      title: "Debrief Submitted",
      message: "Dat Le submitted a debrief for Johnson Family Trust",
      type: "debrief",
      isRead: false,
      userId: "a3f79097-7c44-452d-9fdb-4ea6610f47f0",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      id: "3",
      title: "Task Due Soon",
      message: "AP aging report setup for ABC Corp is due in 5 days",
      type: "task",
      isRead: false,
      userId: "b1945d12-8e60-4489-8f1a-4c5a55c802c0",
      createdAt: new Date().toISOString(),
    },
    {
      id: "4",
      title: "New Client Note",
      message: "Matthew Pereira added notes for ABC Corporation",
      type: "note",
      isRead: true,
      userId: "b1945d12-8e60-4489-8f1a-4c5a55c802c0",
      createdAt: new Date(Date.now() - 172800000).toISOString(),
    },
    {
      id: "5",
      title: "New Task Assigned",
      message: "You have been assigned: Prepare cap table summary for TechStart",
      type: "task",
      isRead: false,
      userId: "910afa82-3f61-4f6f-a9a6-ceec31f0c691",
      createdAt: new Date().toISOString(),
    },
    {
      id: "6",
      title: "New Task Assigned",
      message: "You have been assigned: Draft transfer pricing memo for GlobalTrade",
      type: "task",
      isRead: false,
      userId: "c10d7f57-3f82-4674-81ec-b805beb004a9",
      createdAt: new Date().toISOString(),
    },
    {
      id: "7",
      title: "Debrief In Progress",
      message: "Ganesh Vasan started a debrief for GlobalTrade LLC",
      type: "debrief",
      isRead: false,
      userId: "c10d7f57-3f82-4674-81ec-b805beb004a9",
      createdAt: new Date().toISOString(),
    },
    {
      id: "8",
      title: "Weekly Summary",
      message: "You have 3 tasks due this week and 2 pending debriefs to review",
      type: "summary",
      isRead: false,
      userId: "21969201-a354-4f43-b4e8-0a348c0ecb27",
      createdAt: new Date().toISOString(),
    },
    {
      id: "9",
      title: "Task Completed",
      message: "Q4 estimated payments review for Martinez has been marked complete",
      type: "task",
      isRead: true,
      userId: "503705e4-25ee-4fc5-8c02-33005737be57",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      id: "10",
      title: "New Task Assigned",
      message: "You have been assigned: Request prior year returns from Smith",
      type: "task",
      isRead: false,
      userId: "74120a69-fce8-41fe-91a7-3b55da6791e5",
      createdAt: new Date().toISOString(),
    },
  ]

  return allNotifications.filter((n) => n.userId === userId)
}

// Demo debriefs
export const getDemoDebriefs = (userId?: string) => {
  const debriefs = [
    {
      id: "1",
      date: "2026-01-02",
      type: "Tax Planning",
      notes:
        "Discussed Q4 tax planning strategies with the Johnson family. Reviewed estimated tax payments and identified opportunities for charitable giving before year-end.",
      status: "completed",
      teamMember: "Dat Le",
      teamMemberId: "21969201-a354-4f43-b4e8-0a348c0ecb27",
      organization: "Johnson Family Trust",
    },
    {
      id: "2",
      date: "2026-01-02",
      type: "Bookkeeping Review",
      notes:
        "Monthly bookkeeping review for ABC Corp. Reconciled all accounts, identified $5,200 in unrecorded expenses.",
      status: "completed",
      teamMember: "Matthew Pereira",
      teamMemberId: "910afa82-3f61-4f6f-a9a6-ceec31f0c691",
      organization: "ABC Corporation",
    },
    {
      id: "3",
      date: "2026-01-03",
      type: "CFO Advisory",
      notes: "CFO advisory session with TechStart Inc. Reviewed financial projections for Series A fundraising.",
      status: "completed",
      teamMember: "Andrew Gianares",
      teamMemberId: "b1945d12-8e60-4489-8f1a-4c5a55c802c0",
      organization: "TechStart Inc",
    },
    {
      id: "4",
      date: "2026-01-03",
      type: "International Tax",
      notes:
        "International tax consultation for GlobalTrade LLC. Discussed transfer pricing documentation requirements.",
      status: "in_progress",
      teamMember: "Ganesh Vasan",
      teamMemberId: "40a51c30-5071-4f97-9038-ecfea2c6025a",
      organization: "GlobalTrade LLC",
    },
    {
      id: "5",
      date: "2026-01-03",
      type: "Wealth Management",
      notes: "Wealth management review with the Martinez family. Updated investment policy statement.",
      status: "completed",
      teamMember: "Mark Dwyer",
      teamMemberId: "503705e4-25ee-4fc5-8c02-33005737be57",
      organization: "Martinez Family Office",
    },
    {
      id: "6",
      date: "2026-01-03",
      type: "Client Onboarding",
      notes:
        "New client onboarding call with Smith & Associates. Gathered initial information for 2025 tax preparation.",
      status: "draft",
      teamMember: "Grace Cha",
      teamMemberId: "a3f79097-7c44-452d-9fdb-4ea6610f47f0",
      organization: "Smith & Associates",
    },
  ]

  if (userId) {
    return debriefs.filter((d) => d.teamMemberId === userId)
  }
  return debriefs
}

// Demo recent activity
export const getDemoActivity = () => [
  {
    type: "client_added",
    message: "New client Johnson & Associates added to portfolio",
    time: "2 hours ago",
    user: "Mark Dwyer",
    avatar: "/professional-man-beard.png",
  },
  {
    type: "deliverable_sent",
    message: "Q4 tax planning report sent to Acme Corp",
    time: "4 hours ago",
    user: "Andrew Gianares",
    avatar: "/professional-man.png",
  },
  {
    type: "feedback_received",
    message: "Client feedback received for financial advisory proposal",
    time: "6 hours ago",
    user: "Dat Le",
    avatar: "/professional-asian-man.png",
  },
  {
    type: "task_completed",
    message: "Bookkeeping reconciliation completed for Tech Startup LLC",
    time: "1 day ago",
    user: "Matthew Pereira",
    avatar: "/professional-man-glasses.png",
  },
  {
    type: "debrief_submitted",
    message: "Meeting debrief submitted for GlobalTrade LLC",
    time: "1 day ago",
    user: "Ganesh Vasan",
    avatar: "/placeholder.svg",
  },
]

interface DemoModeContextType {
  isDemoMode: boolean
  toggleDemoMode: () => void
  selectedUser: (typeof DEMO_TEAM_MEMBERS)[0] | null
  setSelectedUser: (user: (typeof DEMO_TEAM_MEMBERS)[0] | null) => void
  demoStats: ReturnType<typeof getDemoStats>
  demoTasks: ReturnType<typeof getDemoTasks>
  demoNotifications: ReturnType<typeof getDemoNotifications>
  demoDebriefs: ReturnType<typeof getDemoDebriefs>
  demoActivity: ReturnType<typeof getDemoActivity>
}

const DemoModeContext = createContext<DemoModeContextType | undefined>(undefined)

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [isDemoMode, setIsDemoMode] = useState(false)
  const [selectedUser, setSelectedUser] = useState<(typeof DEMO_TEAM_MEMBERS)[0] | null>(null)

  // Load demo mode state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("motta-demo-mode")
    const storedUser = localStorage.getItem("motta-demo-user")
    if (stored === "true") {
      setIsDemoMode(true)
      if (storedUser) {
        const user = DEMO_TEAM_MEMBERS.find((u) => u.id === storedUser)
        setSelectedUser(user || DEMO_TEAM_MEMBERS[0])
      } else {
        setSelectedUser(DEMO_TEAM_MEMBERS[0])
      }
    }
  }, [])

  const toggleDemoMode = () => {
    const newValue = !isDemoMode
    setIsDemoMode(newValue)
    localStorage.setItem("motta-demo-mode", String(newValue))
    if (newValue && !selectedUser) {
      setSelectedUser(DEMO_TEAM_MEMBERS[0])
      localStorage.setItem("motta-demo-user", DEMO_TEAM_MEMBERS[0].id)
    }
  }

  const handleSetSelectedUser = (user: (typeof DEMO_TEAM_MEMBERS)[0] | null) => {
    setSelectedUser(user)
    if (user) {
      localStorage.setItem("motta-demo-user", user.id)
    }
  }

  const userId = selectedUser?.id || DEMO_TEAM_MEMBERS[0].id

  return (
    <DemoModeContext.Provider
      value={{
        isDemoMode,
        toggleDemoMode,
        selectedUser,
        setSelectedUser: handleSetSelectedUser,
        demoStats: getDemoStats(userId),
        demoTasks: getDemoTasks(userId),
        demoNotifications: getDemoNotifications(userId),
        demoDebriefs: getDemoDebriefs(userId),
        demoActivity: getDemoActivity(),
      }}
    >
      {children}
    </DemoModeContext.Provider>
  )
}

export function useDemoMode() {
  const context = useContext(DemoModeContext)
  if (context === undefined) {
    throw new Error("useDemoMode must be used within a DemoModeProvider")
  }
  return context
}
