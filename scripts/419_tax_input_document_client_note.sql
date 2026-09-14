-- 419: The per-document note a client writes when uploading.
--
-- The client-side document checklist has had an "Add a note about this
-- document" field since it was designed -- "this is the second W-2, the
-- first one is from my old job" -- and there was nowhere to put it. The
-- note was dropped on submit.
--
-- It goes on tax_input_documents rather than a side table because it is
-- 1:1 with the requested document and dies with it.

alter table public.tax_input_documents
  add column if not exists client_note text;

comment on column public.tax_input_documents.client_note is
  'Free-text note the CLIENT wrote about this specific document at upload time. Client-authored -- distinct from label, which is preparer-facing.';
