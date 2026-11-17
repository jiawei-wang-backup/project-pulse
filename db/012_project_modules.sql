BEGIN;
ALTER TABLE project_reports ADD COLUMN IF NOT EXISTS modules jsonb
  CHECK (jsonb_typeof(modules)='array' AND jsonb_array_length(modules) BETWEEN 1 AND 12);
CREATE INDEX IF NOT EXISTS project_reports_modules_latest_idx
  ON project_reports (lower(project_key), observed_at DESC, report_id DESC) WHERE modules IS NOT NULL;
COMMIT;
