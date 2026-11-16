#!/bin/sh
set -eu

if [ "$(uname -s)" != Linux ]; then
    printf '%s\n' 'This entry point requires Linux. Use pulse-report.pl on macOS.' >&2
    exit 2
fi
for dependency in perl curl; do
    if ! command -v "$dependency" >/dev/null 2>&1; then
        printf 'Missing system dependency: %s. Ask the administrator to install it.\n' "$dependency" >&2
        exit 2
    fi
done
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec perl "$here/pulse-report.pl" "$@"
