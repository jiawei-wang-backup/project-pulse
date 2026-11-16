BEGIN;

-- GitHub 仓库名不区分大小写；统一到登记仓库返回的规范拼写，
-- 避免同一仓库因 owner/repo 大小写不同被展示成多个项目。
UPDATE project_reports p
SET project_key = r.full_name
FROM repositories r
WHERE lower(r.github_host) = 'github.com'
  AND lower(r.full_name) = lower(p.project_key)
  AND p.project_key <> r.full_name;

COMMIT;
