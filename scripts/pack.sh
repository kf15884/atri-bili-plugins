#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/dist"
for p in atri-bilibili atri-bili-eyes; do
 (cd "$ROOT/packages/$p" && npm pack --ignore-scripts --pack-destination "$ROOT/dist")
done
(cd "$ROOT/dist" && sha256sum koishi-plugin-atri-bilibili-0.7.3.tgz koishi-plugin-atri-bili-eyes-0.5.2.tgz > SHA256SUMS)

python3 "$ROOT/scripts/checksums.py"
