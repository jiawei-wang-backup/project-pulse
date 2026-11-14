CREATE TABLE IF NOT EXISTS github_identities (
    github_user_id bigint PRIMARY KEY CHECK (github_user_id > 0),
    developer_id uuid NOT NULL UNIQUE REFERENCES developers,
    github_login text NOT NULL CHECK (btrim(github_login) <> '')
);
