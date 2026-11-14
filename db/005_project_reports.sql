BEGIN;
CREATE TABLE IF NOT EXISTS project_reports (
    device_id uuid NOT NULL REFERENCES devices,
    report_id uuid NOT NULL,
    source_session_id uuid NOT NULL,
    project_key text NOT NULL CHECK (char_length(btrim(project_key)) BETWEEN 1 AND 200),
    goal text NOT NULL CHECK (char_length(btrim(goal)) BETWEEN 1 AND 200),
    milestones jsonb NOT NULL CHECK (jsonb_typeof(milestones) = 'array' AND jsonb_array_length(milestones) BETWEEN 1 AND 12),
    observed_at timestamptz NOT NULL,
    summarizer_tool text NOT NULL REFERENCES tools,
    prompt_version varchar(32) NOT NULL,
    PRIMARY KEY (device_id, report_id),
    FOREIGN KEY (device_id, source_session_id) REFERENCES sessions
);
CREATE INDEX IF NOT EXISTS project_reports_latest_idx ON project_reports (project_key, observed_at DESC, report_id);
COMMIT;
