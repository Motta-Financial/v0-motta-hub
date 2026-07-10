-- 349: Make the zoom-todo dedup index matchable by PostgREST upserts.
--
-- generate-meeting-todos.ts upserts tasks with
--   onConflict: "assignee_id,zoom_meeting_id"
-- which PostgREST turns into ON CONFLICT (assignee_id, zoom_meeting_id).
-- Postgres can only match that arbiter against a COMPLETE unique index —
-- the previous index was partial (WHERE zoom_meeting_id IS NOT NULL), so
-- every hourly zoom-todo-sweep run since 2026-05-13 failed with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification".
--
-- A full unique index is behaviorally identical for normal tasks: rows
-- with NULL zoom_meeting_id never conflict because NULLs are distinct
-- in unique indexes (default NULLS DISTINCT).

DROP INDEX IF EXISTS tasks_unique_zoom_meeting_per_assignee;

CREATE UNIQUE INDEX tasks_unique_zoom_meeting_per_assignee
  ON public.tasks (assignee_id, zoom_meeting_id);
