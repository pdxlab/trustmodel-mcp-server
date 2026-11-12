#!/usr/bin/env bash
# TRUS-2500: poll a *-state.sh script until it prints "same".
#
#   "same"    -> done, exit 0
#   "absent"  -> not visible yet, wait and retry
#   exit 2    -> the registry holds different content; waiting won't change it, exit 2
#   exit 1    -> could not tell (network, 5xx); retry, and show the last error at the end
#
# npm says a new version "may take a few minutes to become available"; the node
# SDK's v0.5.0 took about 4, and a 60-second wait reported a good release as failed
# (TRUS-2495). Waits back off from 10s to 30s.
#
# Usage: wait-for.sh <max seconds> <state script> [args...]
set -uo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <max seconds> <state script> [args...]" >&2
  exit 1
fi
max=$1
shift
sleep_cmd=${RELEASE_SLEEP:-sleep}

waited=0
delay=10
last_err=$(mktemp)
trap 'rm -f "$last_err"' EXIT

while :; do
  state=$("$@" 2>"$last_err")
  rc=$?
  if [ "$rc" -eq 0 ] && [ "$state" = same ]; then
    echo "$* -> same after ${waited}s"
    exit 0
  fi
  if [ "$rc" -eq 2 ]; then
    cat "$last_err" >&2
    exit 2
  fi
  if [ "$waited" -ge "$max" ]; then
    echo "::error::not visible after ${waited}s: $*" >&2
    if [ -s "$last_err" ]; then
      echo "last error:" >&2
      cat "$last_err" >&2
    fi
    exit 1
  fi
  "$sleep_cmd" "$delay"
  waited=$((waited + delay))
  if [ "$delay" -lt 30 ]; then
    delay=$((delay + 5))
  fi
done
