#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! ./ops/local.sh sync; then
  printf '%s GitHub PR sync failed\n' "$(date -u +%FT%TZ)" >&2
  exit 1
fi
