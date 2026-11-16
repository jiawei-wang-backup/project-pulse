BEGIN;
-- Business-project identity remains the existing primary repository UUID.
-- Extra repositories hold their own PRs; usage stays attached to one session.
CREATE TABLE IF NOT EXISTS project_repository_links (
    project_repository_id uuid NOT NULL REFERENCES repositories,
    repository_id uuid NOT NULL REFERENCES repositories,
    device_id uuid NOT NULL,
    source_session_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(project_repository_id,repository_id),
    FOREIGN KEY(device_id,source_session_id) REFERENCES sessions,
    CHECK(project_repository_id<>repository_id)
);
CREATE INDEX IF NOT EXISTS project_repository_links_repo_idx ON project_repository_links(repository_id);
CREATE OR REPLACE VIEW business_projects AS
 SELECT r.* FROM repositories r WHERE
   NOT EXISTS (SELECT 1 FROM project_repository_links l WHERE l.repository_id=r.repository_id)
   OR EXISTS (SELECT 1 FROM sessions s WHERE s.repository_id=r.repository_id)
   OR EXISTS (SELECT 1 FROM project_repository_links l WHERE l.project_repository_id=r.repository_id);
CREATE OR REPLACE VIEW business_project_repositories AS
 SELECT repository_id AS project_repository_id,repository_id FROM business_projects
 UNION
 SELECT project_repository_id,repository_id FROM project_repository_links;
COMMIT;
