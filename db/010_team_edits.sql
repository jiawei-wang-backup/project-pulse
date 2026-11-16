BEGIN;
CREATE TABLE IF NOT EXISTS team_edits (
    actor_device_id uuid NOT NULL REFERENCES devices,
    request_id uuid NOT NULL,
    target_device_id uuid NOT NULL,
    session_id uuid NOT NULL,
    request_digest bytea NOT NULL CHECK (octet_length(request_digest)=32),
    reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 200),
    before_data jsonb NOT NULL,
    after_data jsonb NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (actor_device_id,request_id),
    FOREIGN KEY (target_device_id,session_id) REFERENCES sessions
);
CREATE INDEX IF NOT EXISTS team_edits_target_idx ON team_edits(target_device_id,session_id,changed_at DESC);
COMMIT;
