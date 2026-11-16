BEGIN;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS project_evidence varchar(200);
DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN SELECT conname FROM pg_constraint
    WHERE conrelid='sessions'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%project_state%'
  LOOP EXECUTE format('ALTER TABLE sessions DROP CONSTRAINT %I',constraint_row.conname); END LOOP;
END $$;
ALTER TABLE sessions ADD CONSTRAINT sessions_project_state_check CHECK (
  (project_state IS NULL AND reason_code IS NULL AND observed_at IS NULL)
  OR (project_state IS NOT NULL AND reason_code IS NOT NULL AND observed_at IS NOT NULL AND (
    (project_state='on_track' AND reason_code='progress_observed') OR
    (project_state='blocked' AND reason_code IN ('dependency_unavailable','repeated_failure')) OR
    (project_state='completed' AND reason_code='goal_completed') OR
    (project_state='paused' AND reason_code='user_paused') OR
    (project_state='unknown' AND reason_code='insufficient_evidence')
  ))
);
COMMIT;
