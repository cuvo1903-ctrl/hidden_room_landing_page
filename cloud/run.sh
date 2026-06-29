#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec flock -n /tmp/mysauth-cloud.lock bash -lc 'while true; do node server.js >> cloud.log 2>&1; sleep 5; done'
