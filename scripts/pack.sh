#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
(cd packages/atri-bilibili && npm pack --ignore-scripts --pack-destination ../../dist)
(cd packages/atri-bili-eyes && npm pack --ignore-scripts --pack-destination ../../dist)
