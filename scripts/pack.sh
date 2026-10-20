#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/dist"
for NAME in atri-bilibili atri-bili-eyes; do
 (cd "$ROOT/packages/$NAME" && npm pack --ignore-scripts --pack-destination "$ROOT/dist")
done
(cd "$ROOT/dist" && sha256sum *.tgz > SHA256SUMS)
