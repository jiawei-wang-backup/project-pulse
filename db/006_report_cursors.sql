CREATE TABLE IF NOT EXISTS report_cursors (
    device_id uuid NOT NULL REFERENCES devices,
    source_id uuid NOT NULL,
    byte_offset bigint NOT NULL CHECK (byte_offset > 0),
    context jsonb NOT NULL,
    PRIMARY KEY (device_id, source_id)
);
