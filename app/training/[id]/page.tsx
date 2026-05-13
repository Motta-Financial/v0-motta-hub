import { notFound } from "next/navigation"
import { DashboardLayout } from "@/components/dashboard-layout"
import { TrainingVideoDetail } from "@/components/training/training-video-detail"
import { createClient } from "@/lib/supabase/server"
import type { TrainingVideo } from "@/components/training/types"

interface PageProps {
  params: Promise<{ id: string }>
}

// Server-fetch the video on first paint so the page renders instantly
// with content (and good SEO for internal search). The client component
// then handles edits + revalidation.
async function fetchVideo(id: string): Promise<TrainingVideo | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("training_videos")
    .select("*, training_categories(id, name, color)")
    .eq("id", id)
    .maybeSingle()
  if (error || !data) return null
  return data as TrainingVideo
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params
  const video = await fetchVideo(id)
  if (!video) return { title: "Training video | Motta Hub" }
  return {
    title: `${video.title || "Training video"} | Motta Hub`,
    description: video.description || "Motta Financial training video",
  }
}

export default async function TrainingVideoPage({ params }: PageProps) {
  const { id } = await params
  const video = await fetchVideo(id)
  if (!video) notFound()
  return (
    <DashboardLayout>
      <TrainingVideoDetail initialVideo={video} />
    </DashboardLayout>
  )
}
