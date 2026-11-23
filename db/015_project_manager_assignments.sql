BEGIN;

CREATE TABLE IF NOT EXISTS project_manager_assignments (
  project_key text PRIMARY KEY CHECK (project_key = lower(project_key)),
  member_id text NOT NULL REFERENCES ember_members(member_id)
);

CREATE OR REPLACE VIEW project_manager_names AS
SELECT project_key, m.display_name
FROM project_owners o
FULL JOIN project_manager_assignments a USING (project_key)
LEFT JOIN devices d ON d.device_id = o.device_id
JOIN ember_members m ON m.member_id = coalesce(a.member_id, d.ember_member_id);

COMMIT;
