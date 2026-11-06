#!/usr/bin/env bash
# TRUS-2500: what the MCP Registry holds for <name>@<version>, compared with what
# this release publishes: the npm package it points at and this repo's GitHub id.
#
#   stdout "absent", exit 0   registry answered 404
#   stdout "same",   exit 0   entry exists and points at our package and repo
#   exit 2                    entry exists but points elsewhere
#   exit 1                    anything else (network, 5xx, unreadable body)
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: $0 <server name> <version> <npm identifier> <repository id>" >&2
  exit 1
fi
name=$1 version=$2 identifier=$3 repo_id=$4
base=${MCP_REGISTRY_URL:-https://registry.modelcontextprotocol.io}

body=$(mktemp)
trap 'rm -f "$body"' EXIT

url="$base/v0.1/servers/${name//\//%2F}/versions/$version"
if ! status=$(curl --silent --show-error --max-time 30 --output "$body" --write-out '%{http_code}' "$url"); then
  echo "::error::could not reach $url" >&2
  exit 1
fi

case "$status" in
  404)
    echo absent
    exit 0
    ;;
  200) ;;
  *)
    echo "::error::$url answered HTTP $status" >&2
    head -c 500 "$body" >&2 || true
    exit 1
    ;;
esac

# An entry with no name or version is unreadable (exit 1). Once it has those, a
# missing package or repository id counts as pointing elsewhere (exit 2).
if ! found=$(jq -er '.server | select(.name and .version) | [.name, .version, .packages[0].identifier, .repository.id] | map(. // "") | join(" ")' "$body" 2>/dev/null); then
  echo "::error::$url returned a body without the expected fields" >&2
  exit 1
fi
want="$name $version $identifier $repo_id"
if [ "$found" = "$want" ]; then
  echo same
  exit 0
fi
echo "::error::registry has $name@$version as [$found], expected [$want]" >&2
exit 2
