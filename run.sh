#!/usr/bin/env bash
# Start the tracker. Pass through any option python3 -m tracker accepts,
# e.g. ./run.sh --port 9000 --no-browser
set -euo pipefail
cd "$(dirname "$0")"
exec python3 -m tracker "$@"
