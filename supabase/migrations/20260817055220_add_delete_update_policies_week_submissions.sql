-- Add missing DELETE and UPDATE policies on week_submissions so teachers can reset a group's weekly submission.
-- The table already has SELECT and INSERT policies for anon,authenticated; DELETE and UPDATE were absent,
-- which caused the teacher "退回本周提交" feature to fail with an RLS permission error.

CREATE POLICY "anon_delete_week_submissions"
  ON week_submissions FOR DELETE
  TO anon, authenticated
  USING (true);

CREATE POLICY "anon_update_week_submissions"
  ON week_submissions FOR UPDATE
  TO anon, authenticated
  USING (true) WITH CHECK (true);
