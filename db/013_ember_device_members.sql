BEGIN;

CREATE TABLE IF NOT EXISTS ember_members (
  member_id text PRIMARY KEY,
  display_name text NOT NULL
);

ALTER TABLE devices ADD COLUMN IF NOT EXISTS ember_member_id text REFERENCES ember_members(member_id);

CREATE OR REPLACE VIEW reporting_devices AS
SELECT v.device_id, v.last_seen_at, v.revoked_at,
       coalesce('ember:' || e.member_id, d.developer_id::text) AS member_key,
       coalesce(e.display_name, d.display_name) AS display_name
FROM devices v
JOIN developers d USING (developer_id)
LEFT JOIN ember_members e ON e.member_id = v.ember_member_id;

COMMIT;
