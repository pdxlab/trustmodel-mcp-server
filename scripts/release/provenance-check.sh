#!/usr/bin/env bash
# TRUS-2500: whether npm's SLSA provenance for <package>@<version> says it was built
# by this repo's release workflow, from this tag, at this commit. A provenance
# attestation from any other repo, workflow, ref or commit is not this release.
#
#   stdout "absent", exit 0   npm answered 404: no attestations visible yet
#   stdout "same",   exit 0   exactly one SLSA v1 provenance, naming all four values
#   exit 2                    attestations exist but none, or more than one, is ours
#   exit 1                    anything else (network, 5xx, unreadable body)
#
# Usage: provenance-check.sh <package> <version> <repository url> <workflow path> <ref> <commit>
set -euo pipefail

if [ "$#" -ne 6 ]; then
  echo "usage: $0 <package> <version> <repository url> <workflow path> <ref> <commit>" >&2
  exit 1
fi
pkg=$1 version=$2 repo=$3 path=$4 ref=$5 commit=$6
base=${NPM_REGISTRY_URL:-https://registry.npmjs.org}

body=$(mktemp)
trap 'rm -f "$body"' EXIT

url="$base/-/npm/v1/attestations/$pkg@$version"
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

# One line per SLSA v1 provenance: repository, workflow path, ref, commit.
if ! found=$(jq -er '
    .attestations
    | map(select(.predicateType == "https://slsa.dev/provenance/v1")
          | .bundle.dsseEnvelope.payload | @base64d | fromjson | .predicate.buildDefinition
          | [.externalParameters.workflow.repository, .externalParameters.workflow.path,
             .externalParameters.workflow.ref, .resolvedDependencies[0].digest.gitCommit]
          | map(. // "") | join(" "))
    | join("\n")' "$body" 2>/dev/null); then
  echo "::error::$url returned a body without readable attestations" >&2
  exit 1
fi
want="$repo $path $ref $commit"
if [ "$found" = "$want" ]; then
  echo same
  exit 0
fi
echo "::error::$pkg@$version provenance is [${found:-none}], expected [$want]" >&2
exit 2
