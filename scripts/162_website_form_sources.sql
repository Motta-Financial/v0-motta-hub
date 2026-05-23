-- Register the public website intake form so submissions coming in
-- through POST /api/public/intake can be stored in
-- jotform_intake_submissions and pick up the same downstream
-- pipeline (Karbon push, ALFRED enrichment, team notify) as the
-- legacy Jotform-hosted intake form. The "jotform_form_id" of
-- 'website' is synthetic — no Jotform form by that ID exists; it's
-- just the routing key the public route uses to look this row up.

INSERT INTO jotform_forms (jotform_form_id, title, kind, created_at)
VALUES ('website', 'Motta Hub Website Intake', 'intake', now())
ON CONFLICT (jotform_form_id) DO UPDATE
  SET title = EXCLUDED.title,
      kind  = EXCLUDED.kind;

-- Same idea for the contact form, kept separate so the dashboards
-- can filter "intake" vs "contact" submissions cleanly.
INSERT INTO jotform_forms (jotform_form_id, title, kind, created_at)
VALUES ('website-contact', 'Motta Hub Website Contact Form', 'feedback', now())
ON CONFLICT (jotform_form_id) DO UPDATE
  SET title = EXCLUDED.title,
      kind  = EXCLUDED.kind;
