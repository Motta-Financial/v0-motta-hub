/**
 * Shared client-side types for the Training Library UI.
 * Mirrors the row shape returned by /api/training/videos.
 */

export interface TrainingCategory {
  id: string
  name: string
  description: string | null
  color: string | null
  sort_order: number
  video_count?: number
}

export interface CategoriesResponse {
  categories: TrainingCategory[]
  uncategorized_count: number
  total_count: number
}

export interface TrainingVideo {
  id: string
  loom_url: string
  loom_video_id: string
  title: string | null
  description: string | null
  thumbnail_url: string | null
  duration_seconds: number | null
  author_name: string | null
  category_id: string | null
  department: string | null
  tags: string[] | null
  is_pinned: boolean
  added_by_id: string | null
  added_by_name: string | null
  created_at: string
  updated_at: string
  training_categories: {
    id: string
    name: string
    color: string | null
  } | null
}

export interface VideosResponse {
  videos: TrainingVideo[]
}
