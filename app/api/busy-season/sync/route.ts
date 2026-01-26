import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

// Helper to parse Karbon work item title format: "TAX | Individual (1040) | Client Name | YYYY"
function parseKarbonTitle(title: string): { 
  entityType: string
  clientName: string
  taxYear: number
} {
  const parts = title.split("|").map(p => p.trim())
  
  let entityType = "Other"
  let clientName = title
  let taxYear = new Date().getFullYear()
  
  if (parts.length >= 4) {
    const entityPart = parts[1].toLowerCase()
    clientName = parts[2]
    const yearPart = parts[3]
    
    if (entityPart.includes("1040") || entityPart.includes("individual")) {
      entityType = "1040 - Individual"
    } else if (entityPart.includes("1065") || entityPart.includes("partnership")) {
      entityType = "1065 - Partnership"
    } else if (entityPart.includes("1120-s") || entityPart.includes("1120s") || entityPart.includes("s-corp")) {
      entityType = "1120-S - S-Corp"
    } else if (entityPart.includes("1120") || entityPart.includes("c-corp")) {
      entityType = "1120 - C-Corp"
    } else if (entityPart.includes("990") || entityPart.includes("nonprofit")) {
      entityType = "990 - Nonprofit"
    } else {
      entityType = parts[1]
    }
    
    const yearMatch = yearPart.match(/20\d{2}/)
    if (yearMatch) {
      taxYear = parseInt(yearMatch[0])
    }
  } else if (parts.length === 3) {
    const entityPart = parts[1].toLowerCase()
    clientName = parts[2]
    
    if (entityPart.includes("1040") || entityPart.includes("individual")) {
      entityType = "1040 - Individual"
    } else if (entityPart.includes("1065") || entityPart.includes("partnership")) {
      entityType = "1065 - Partnership"
    } else if (entityPart.includes("1120-s") || entityPart.includes("1120s") || entityPart.includes("s-corp")) {
      entityType = "1120-S - S-Corp"
    } else if (entityPart.includes("1120") || entityPart.includes("c-corp")) {
      entityType = "1120 - C-Corp"
    }
    
    const yearMatch = title.match(/20\d{2}/)
    if (yearMatch) {
      taxYear = parseInt(yearMatch[0])
    }
  }
  
  return { entityType, clientName, taxYear }
}

// Map Karbon status to our status
function mapKarbonStatus(workStatus: string, primaryStatus: string): string {
  const status = (primaryStatus || workStatus || "").toLowerCase()
  if (status.includes("prospect")) return "Prospect"
  if (status.includes("proposal") && status.includes("sent")) return "Proposal Sent"
  if (status.includes("proposal") && status.includes("signed")) return "Proposal Signed"
  if (status.includes("document") && status.includes("received")) return "Documents Received"
  if (status.includes("ready") && status.includes("prep")) return "Ready for Prep"
  if (status.includes("waiting") || status.includes("client")) return "Waiting for Client"
  if (status.includes("preparing") || status.includes("in progress") || status.includes("active")) return "Actively Preparing"
  if (status.includes("review")) return "In Review"
  if (status.includes("final")) return "Finalizing"
  if (status.includes("sent to client")) return "Sent to Client"
  if (status.includes("filed") || status.includes("complete") || status.includes("done")) return "E-filed/Manually Filed"
  return "Actively Preparing"
}

// Calculate progress based on status
function calculateProgress(status: string): number {
  const progressMap: Record<string, number> = {
    "Prospect": 0,
    "Proposal Sent": 5,
    "Proposal Signed": 10,
    "Documents Received": 15,
    "Ready for Prep": 20,
    "Waiting for Client": 30,
    "Actively Preparing": 50,
    "In Review": 75,
    "Finalizing": 90,
    "Sent to Client": 95,
    "E-filed/Manually Filed": 100,
  }
  return progressMap[status] || 50
}

// POST - Sync tax work items from Karbon to Supabase
export async function POST() {
  try {
    const supabase = await createClient()
    // Fetch work items from Karbon
    const karbonResponse = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/karbon/work-items`,
      { cache: "no-store" }
    )
    
    if (!karbonResponse.ok) {
      return NextResponse.json({ error: "Failed to fetch from Karbon" }, { status: 500 })
    }
    
    const karbonData = await karbonResponse.json()
    
    if (!karbonData.workItems) {
      return NextResponse.json({ error: "No work items returned from Karbon" }, { status: 500 })
    }
    
    // Filter for tax work items only (title starts with "TAX |")
    const taxWorkItems = karbonData.workItems.filter((item: any) => {
      const titleLower = (item.Title || "").toLowerCase().trim()
      return titleLower.startsWith("tax |") || titleLower.startsWith("tax|")
    })
    
    // Determine workflow status based on Karbon status
    // Karbon status determines where client is in their journey
    // Workflow status is what internal team uses to track busy season work
    function determineWorkflowStatus(karbonStatus: string): string {
      const status = karbonStatus.toLowerCase()
      // Pre-engagement stages - not yet active for tax prep
      if (status.includes("prospect")) return "Lead"
      if (status.includes("proposal") && status.includes("sent")) return "Proposal Pending"
      // Post-engagement stages - active for tax prep workflow
      if (status.includes("proposal") && status.includes("signed")) return "Requesting Documents"
      if (status.includes("document") && status.includes("received")) return "Documents Received"
      if (status.includes("ready") && status.includes("prep")) return "Ready for Prep"
      if (status.includes("preparing") || status.includes("in progress") || status.includes("active")) return "In Preparation"
      if (status.includes("review")) return "In Review"
      if (status.includes("final")) return "Finalizing"
      if (status.includes("sent to client")) return "Awaiting Client Approval"
      if (status.includes("filed") || status.includes("complete") || status.includes("done")) return "Filed"
      if (status.includes("waiting") || status.includes("client")) return "Waiting on Client"
      return "Pending Review"
    }

    // Transform Karbon work items to our format
    const workItemsToSync = taxWorkItems.map((item: any) => {
      const parsed = parseKarbonTitle(item.Title)
      const karbonStatus = item.PrimaryStatus || item.WorkStatus || "Unknown"
      const mappedStatus = mapKarbonStatus(item.WorkStatus, item.PrimaryStatus)
      const workflowStatus = determineWorkflowStatus(karbonStatus)
      const assignedTo = item.AssignedTo?.FullName || null
      
      // Determine if client is active for busy season (proposal signed or later)
      const isActiveClient = !karbonStatus.toLowerCase().includes("prospect") && 
                            !(karbonStatus.toLowerCase().includes("proposal") && karbonStatus.toLowerCase().includes("sent"))
      
      return {
        karbon_work_key: item.WorkKey,
        client_name: item.ClientName || parsed.clientName,
        entity_type: parsed.entityType,
        tax_year: parsed.taxYear,
        karbon_status: karbonStatus, // Store the raw Karbon status
        primary_status: mappedStatus, // Mapped status for display
        workflow_status: workflowStatus, // Internal workflow status
        preparer: assignedTo || "Unassigned",
        assigned_to: assignedTo,
        in_queue: isActiveClient && !assignedTo, // Only in queue if active client without assignee
        due_date: item.DueDate || null,
        progress: calculateProgress(mappedStatus),
        documents_received: isActiveClient && (
          karbonStatus.toLowerCase().includes("document") || 
          karbonStatus.toLowerCase().includes("prep") ||
          karbonStatus.toLowerCase().includes("review") ||
          karbonStatus.toLowerCase().includes("filed")
        ),
        notes: item.Description || "",
        is_priority: item.Priority === "High",
        last_updated_by: "Karbon Sync",
        karbon_url: `https://app2.karbonhq.com/work/${item.WorkKey}`,
      }
    })
    
    // Get existing work items to check which ones already exist
    const existingKeys = workItemsToSync.map((w: any) => w.karbon_work_key)
    const { data: existingItems } = await supabase
      .from("busy_season_work_items")
      .select("karbon_work_key")
      .in("karbon_work_key", existingKeys)
    
    const existingKeySet = new Set(existingItems?.map(item => item.karbon_work_key) || [])
    
    // Split into new items (insert) and existing items (update only Karbon fields)
    const newItems = workItemsToSync.filter((w: any) => !existingKeySet.has(w.karbon_work_key))
    const existingItemsToUpdate = workItemsToSync.filter((w: any) => existingKeySet.has(w.karbon_work_key))
    
    let insertedCount = 0
    let updatedCount = 0
    
    // Insert new items with all fields (including initial status from Karbon)
    if (newItems.length > 0) {
      const { data: insertedData, error: insertError } = await supabase
        .from("busy_season_work_items")
        .insert(newItems)
        .select()
      
      if (insertError) {
        console.error("Insert error:", insertError)
      } else {
        insertedCount = insertedData?.length || 0
      }
    }
    
    // Update existing items - ONLY update Karbon-sourced fields, preserve internal workflow fields
    // Internal fields preserved: workflow_status, preparer, assigned_to, in_queue, is_priority, notes, last_follow_up_date, ready_for_prep
    for (const item of existingItemsToUpdate) {
      const { error: updateError } = await supabase
        .from("busy_season_work_items")
        .update({
          // Update Karbon-sourced fields
          client_name: item.client_name,
          entity_type: item.entity_type,
          tax_year: item.tax_year,
          due_date: item.due_date,
          karbon_url: item.karbon_url,
          karbon_status: item.karbon_status, // Always sync Karbon status
          primary_status: item.primary_status, // Update mapped status
        })
        .eq("karbon_work_key", item.karbon_work_key)
      
      if (!updateError) {
        updatedCount++
      }
    }

    // Fetch tasks for each work item and update task counts
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    
    // Get all synced items to update task info
    const { data: allItems } = await supabase
      .from("busy_season_work_items")
      .select("id, karbon_work_key")
    
    let taskUpdateCount = 0
    for (const item of allItems || []) {
      try {
        const tasksResponse = await fetch(
          `${appUrl}/api/karbon/work-items/${item.karbon_work_key}/tasks`,
          { cache: "no-store" }
        )
        
        if (tasksResponse.ok) {
          const tasksData = await tasksResponse.json()
          const tasks = tasksData.tasks || []
          
          const totalTasks = tasks.length
          const completedTasks = tasks.filter((t: any) => t.IsComplete).length
          
          await supabase
            .from("busy_season_work_items")
            .update({
              total_tasks: totalTasks,
              completed_tasks: completedTasks,
            })
            .eq("id", item.id)
          
          taskUpdateCount++
        }
      } catch {
        // Skip task fetch errors silently
      }
    }
    
    return NextResponse.json({ 
      success: true, 
      inserted: insertedCount,
      updated: updatedCount,
      tasksUpdated: taskUpdateCount,
      total: karbonData.workItems.length,
      taxItems: taxWorkItems.length,
      message: `Synced from Karbon: ${insertedCount} new items added, ${updatedCount} existing items updated, ${taskUpdateCount} task counts refreshed`
    })
    
  } catch (err) {
    return NextResponse.json({ 
      error: err instanceof Error ? err.message : "Sync failed" 
    }, { status: 500 })
  }
}
