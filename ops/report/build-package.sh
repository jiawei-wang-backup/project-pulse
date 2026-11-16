#!/bin/sh
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo=$(CDPATH= cd -- "$here/../.." && pwd)
output=${1:-"$repo/project-pulse-report.zip"}
stage=$(mktemp -d "${TMPDIR:-/tmp}/project-pulse-package.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM

mkdir "$stage/project-pulse-report"
cp "$here/README.md" "$stage/project-pulse-report/README.md"
cp "$here/PROMPT.txt" "$stage/project-pulse-report/PROMPT.txt"
cp "$here/VERSION" "$stage/project-pulse-report/VERSION"
cp "$here/UPGRADE.md" "$stage/project-pulse-report/UPGRADE.md"
cp "$here/pulse-report.pl" "$stage/project-pulse-report/pulse-report.pl"
cp "$here/pulse-report.ps1" "$stage/project-pulse-report/pulse-report.ps1"
cp "$here/pulse-report-linux.sh" "$stage/project-pulse-report/pulse-report-linux.sh"
cp "$repo/docs/lan-report.md" "$stage/project-pulse-report/lan-report.md"
chmod 755 "$stage/project-pulse-report/pulse-report.pl"
chmod 755 "$stage/project-pulse-report/pulse-report-linux.sh"
(cd "$stage/project-pulse-report" && /usr/bin/shasum -a 256 README.md PROMPT.txt VERSION UPGRADE.md pulse-report.pl pulse-report.ps1 pulse-report-linux.sh lan-report.md > SHA256SUMS)

rm -f "$output"
(cd "$stage" && /usr/bin/zip -X -q -r "$output" project-pulse-report)
/usr/bin/shasum -a 256 "$output"
