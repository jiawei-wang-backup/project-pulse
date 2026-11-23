BEGIN;
CREATE TABLE IF NOT EXISTS project_owners (
  project_key text PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices
);
-- Historical imports have no receipt order per project. Only infer an owner
-- when every recorded report came from the same device.
INSERT INTO project_owners(project_key,device_id)
SELECT lower(project_key),min(device_id::text)::uuid FROM project_reports
GROUP BY lower(project_key) HAVING count(DISTINCT device_id)=1
ON CONFLICT DO NOTHING;
COMMIT;
