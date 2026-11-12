#!/usr/bin/env bash
# TRUS-2500: whether <repo> already has a GitHub Release for <tag>, so a re-run of
# the github-release job (including one whose earlier create succeeded but lost
# its response) doesn't fail on "already exists".
#
#   stdout "absent", exit 0   GitHub answered 404: no published release for the tag
#   stdout "same",   exit 0   a published, non-draft, non-prerelease release for the tag
#   exit 2                    a release exists for the tag but isn't one this job makes
#   exit 1                    anything else (network, 401/403, 5xx, unreadable body)
#
# Only a 404 allows a create. Reads GH_TOKEN from the environment and hands it to
# curl on stdin, so it never appears in the process list.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <owner/repo> <tag>" >&2
  exit 1
fi
repo=$1 tag=$2
: "${GH_TOKEN:?GH_TOKEN is required}"
base=${GITHUB_API_URL:-https://api.github.com}

body=$(mktemp)
trap 'rm -f "$body"' EXIT

url="$base/repos/$repo/releases/tags/$tag"
if ! status=$(printf 'Authorization: Bearer %s\n' "$GH_TOKEN" | curl --silent --show-error --max-time 30 \
  --header @- --header 'Accept: application/vnd.github+json' --header 'X-GitHub-Api-Version: 2022-11-28' \
  --output "$body" --write-out '%{http_code}' "$url"); then
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

if ! found=$(jq -er 'select(.tag_name) | [.tag_name, .draft, .prerelease] | map(tostring) | join(" ")' "$body" 2>/dev/null); then
  echo "::error::$url returned a body without the expected fields" >&2
  exit 1
fi
want="$tag false false"
if [ "$found" = "$want" ]; then
  echo same
  exit 0
fi
echo "::error::release for $tag is [$found], expected [$want]" >&2
exit 2
