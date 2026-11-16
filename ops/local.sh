#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p .pulse
container=project-pulse-local-db

if [[ ! -f .pulse/local.env ]]; then
  printf 'POSTGRES_PASSWORD=%s\nPULSE_HOST=127.0.0.1\nPORT=4185\n' \
    "$(openssl rand -hex 24)" > .pulse/local.env
fi
set -a
source .pulse/local.env
set +a

if ! docker container inspect "$container" >/dev/null 2>&1; then
  docker run -d --name "$container" --restart unless-stopped -e POSTGRES_PASSWORD \
    -v project-pulse-local-data:/var/lib/postgresql/data -p 127.0.0.1::5432 postgres:17 >/dev/null
else
  docker start "$container" >/dev/null
fi
for i in {1..20}; do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
db_port=$(docker port "$container" 5432/tcp | awk -F: 'NR==1{print $NF}')
export DATABASE_URL="postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${db_port}/postgres"
psql_local() {
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 "$@"
}
if [[ $(psql_local -Atc "SELECT to_regclass('public.developers') IS NOT NULL") == f ]]; then
  psql_local < db/001_init.sql >/dev/null
fi
psql_local < db/002_session_title.sql >/dev/null
psql_local < db/003_session_display_title.sql >/dev/null
psql_local < db/004_session_workspace.sql >/dev/null
psql_local < db/005_project_reports.sql >/dev/null
psql_local < db/006_report_cursors.sql >/dev/null
psql_local < db/007_github_identities.sql >/dev/null
psql_local < db/008_project_key_case.sql >/dev/null
psql_local < db/009_project_lifecycle.sql >/dev/null
psql_local < db/010_team_edits.sql >/dev/null
case "${1:-serve}" in
  serve) PULSE_LOCAL_VIEW=1 PULSE_HOST=127.0.0.1 exec node server.mjs ;;
  serve-lan)
    lan_ip=${2:-}
    if [[ ! "$lan_ip" =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)([0-9]{1,3}\.)?[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
      printf '%s\n' 'Usage: ops/local.sh serve-lan PRIVATE_IPV4' >&2
      exit 2
    fi
    PULSE_REPORT_ONLY=1 PULSE_LAN_ENROLLMENT=1 PULSE_LOCAL_VIEW=0 PULSE_HOST="$lan_ip" exec node server.mjs ;;
  sync) exec node db/sync-prs.mjs ;;
  admin) shift; exec node db/admin.mjs "$@" ;;
  backup)
    backup=$(mktemp .pulse/backup.XXXXXXXX)
    if docker exec "$container" pg_dump -U postgres -Fc postgres > "$backup"; then
      mv "$backup" "${backup}.dump"
      printf '%s\n' "${backup}.dump"
    else
      rm -f "$backup"
      exit 1
    fi ;;
  *) printf '%s\n' 'Usage: ops/local.sh serve|serve-lan|sync|admin|backup' >&2; exit 2 ;;
esac
