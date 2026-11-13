BEGIN;

CREATE TABLE developers (
    developer_id uuid PRIMARY KEY,
    display_name text NOT NULL CHECK (btrim(display_name) <> '')
);

CREATE TABLE devices (
    device_id uuid PRIMARY KEY,
    developer_id uuid NOT NULL REFERENCES developers,
    credential_digest bytea NOT NULL UNIQUE CHECK (octet_length(credential_digest) = 32),
    revoked_at timestamptz,
    last_seen_at timestamptz
);
CREATE INDEX devices_developer_idx ON devices (developer_id);

CREATE TABLE tools (
    tool_id text PRIMARY KEY CHECK (tool_id ~ '^[a-z][a-z0-9_]{0,63}$')
);
INSERT INTO tools VALUES ('codex'), ('claude_code');

CREATE TABLE repositories (
    repository_id uuid PRIMARY KEY,
    github_host text NOT NULL,
    github_id bigint NOT NULL CHECK (github_id > 0),
    full_name text NOT NULL,
    business_category text,
    completed_at timestamptz,
    last_pr_sync_at timestamptz,
    pr_sync_cursor timestamptz,
    UNIQUE (github_host, github_id)
);
CREATE UNIQUE INDEX repositories_name_idx
    ON repositories (lower(github_host), lower(full_name));

CREATE TABLE project_milestones (
    milestone_id uuid PRIMARY KEY,
    repository_id uuid NOT NULL REFERENCES repositories,
    position integer NOT NULL CHECK (position > 0),
    title text NOT NULL,
    due_on date,
    state text NOT NULL CHECK (state IN ('planned', 'review', 'accepted')),
    UNIQUE (repository_id, position)
);

CREATE TABLE sessions (
    device_id uuid NOT NULL REFERENCES devices,
    session_id uuid NOT NULL,
    tool_id text NOT NULL REFERENCES tools,
    repository_id uuid REFERENCES repositories,
    revision bigint NOT NULL CHECK (revision > 0),
    started_at timestamptz,
    last_activity_at timestamptz NOT NULL,
    project_state text,
    reason_code text,
    observed_at timestamptz,
    PRIMARY KEY (device_id, session_id),
    CHECK (started_at IS NULL OR started_at <= last_activity_at),
    CHECK (
        (project_state IS NULL AND reason_code IS NULL AND observed_at IS NULL)
        OR (project_state IS NOT NULL AND reason_code IS NOT NULL
            AND observed_at IS NOT NULL AND observed_at <= last_activity_at
            AND ((project_state = 'on_track' AND reason_code = 'progress_observed')
              OR (project_state = 'blocked' AND reason_code IN ('dependency_unavailable', 'repeated_failure'))
              OR (project_state = 'unknown' AND reason_code = 'insufficient_evidence')))
    )
);
CREATE INDEX sessions_repo_activity_idx ON sessions (repository_id, last_activity_at DESC);
CREATE INDEX sessions_device_activity_idx ON sessions (device_id, last_activity_at DESC);
CREATE INDEX sessions_repo_observation_idx ON sessions (repository_id, observed_at DESC)
    WHERE observed_at IS NOT NULL;

CREATE TABLE agents (
    device_id uuid NOT NULL,
    session_id uuid NOT NULL,
    agent_id uuid NOT NULL,
    parent_agent_id uuid,
    kind text NOT NULL CHECK (kind IN ('main', 'subagent')),
    role varchar(64),
    state text NOT NULL CHECK (state IN ('running', 'idle', 'completed', 'failed', 'unknown')),
    revision bigint NOT NULL CHECK (revision > 0),
    last_activity_at timestamptz NOT NULL,
    PRIMARY KEY (device_id, agent_id),
    UNIQUE (device_id, session_id, agent_id),
    FOREIGN KEY (device_id, session_id) REFERENCES sessions,
    FOREIGN KEY (device_id, session_id, parent_agent_id)
        REFERENCES agents (device_id, session_id, agent_id) DEFERRABLE INITIALLY DEFERRED,
    CHECK ((kind = 'main' AND parent_agent_id IS NULL)
        OR (kind = 'subagent' AND parent_agent_id IS NOT NULL AND parent_agent_id <> agent_id))
);
CREATE UNIQUE INDEX agents_one_main_idx ON agents (device_id, session_id) WHERE kind = 'main';
CREATE INDEX agents_running_idx ON agents (last_activity_at DESC) WHERE state = 'running';

CREATE TABLE usage_events (
    device_id uuid NOT NULL,
    event_id uuid NOT NULL,
    session_id uuid NOT NULL,
    agent_id uuid,
    occurred_at timestamptz NOT NULL,
    provider text,
    model text,
    accounting text NOT NULL CHECK (accounting IN ('billable', 'included')),
    input_tokens bigint CHECK (input_tokens >= 0),
    cached_input_tokens bigint CHECK (cached_input_tokens >= 0),
    output_tokens bigint CHECK (output_tokens >= 0),
    PRIMARY KEY (device_id, event_id),
    FOREIGN KEY (device_id, session_id) REFERENCES sessions,
    FOREIGN KEY (device_id, session_id, agent_id) REFERENCES agents (device_id, session_id, agent_id),
    CHECK (input_tokens IS NULL OR cached_input_tokens IS NULL OR cached_input_tokens <= input_tokens)
);
CREATE INDEX usage_events_time_idx ON usage_events (occurred_at) WHERE accounting = 'billable';
CREATE INDEX usage_events_session_idx ON usage_events (device_id, session_id, occurred_at);

CREATE TABLE session_summaries (
    device_id uuid NOT NULL,
    summary_id uuid NOT NULL,
    session_id uuid NOT NULL,
    observed_at timestamptz NOT NULL,
    summary text NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 1 AND 200),
    summarizer_tool text NOT NULL REFERENCES tools,
    prompt_version varchar(32) NOT NULL,
    PRIMARY KEY (device_id, summary_id),
    FOREIGN KEY (device_id, session_id) REFERENCES sessions
);
CREATE INDEX session_summaries_latest_idx
    ON session_summaries (device_id, session_id, observed_at DESC, summary_id);

CREATE TABLE ingest_batches (
    device_id uuid NOT NULL REFERENCES devices,
    batch_id uuid NOT NULL,
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    schema_version integer NOT NULL CHECK (schema_version > 0),
    collector_version varchar(32) NOT NULL,
    sent_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, batch_id)
);

CREATE TABLE pull_requests (
    repository_id uuid NOT NULL REFERENCES repositories,
    number bigint NOT NULL CHECK (number > 0),
    title text NOT NULL,
    url text NOT NULL,
    state text NOT NULL CHECK (state IN ('open', 'closed', 'merged')),
    is_draft boolean NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
    PRIMARY KEY (repository_id, number)
);
CREATE INDEX pull_requests_latest_idx ON pull_requests (repository_id, created_at DESC, number DESC);

CREATE TABLE provider_accounts (
    account_id uuid PRIMARY KEY,
    developer_id uuid NOT NULL REFERENCES developers,
    provider text NOT NULL,
    UNIQUE (account_id, developer_id)
);
CREATE TABLE quota_snapshots (
    account_id uuid NOT NULL,
    developer_id uuid NOT NULL,
    limit_id text NOT NULL,
    window_key text NOT NULL,
    observed_at timestamptz NOT NULL,
    window_minutes integer CHECK (window_minutes > 0),
    used_percent numeric CHECK (used_percent >= 0),
    resets_at timestamptz,
    PRIMARY KEY (account_id, limit_id, window_key, observed_at),
    FOREIGN KEY (account_id, developer_id) REFERENCES provider_accounts (account_id, developer_id)
);

COMMIT;
