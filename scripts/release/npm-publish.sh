#!/usr/bin/env bash
# TRUS-2500: publish a verified tarball with a provenance attestation.
#
# npm can answer "cannot publish over the previously published versions" when a
# publish seconds earlier is not readable yet (the node SDK's v0.5.0 re-run,
# TRUS-2495). That answer says nothing about which bytes npm has, so it passes
# here with a warning and the wait step that follows decides: green only when
# npm's shasum is ours. Every other publish error fails.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <path to .tgz>" >&2
  exit 1
fi
tarball=$1

# "./" so npm reads a local file: a bare "package/<name>.tgz" is taken as GitHub
# shorthand (user/repo) and npm tries to git-clone it.
case "$tarball" in
  /* | ./*) ;;
  *) tarball="./$tarball" ;;
esac

log=$(mktemp)
trap 'rm -f "$log"' EXIT

# --provenance: the repo is public, so npm can attest the build. Asking for it
# explicitly makes a publish that cannot be attested fail instead of going out
# without provenance.
if npm publish "$tarball" --access public --ignore-scripts --provenance >"$log" 2>&1; then
  cat "$log"
  exit 0
fi
cat "$log"
if grep -q 'cannot publish over the previously published versions' "$log"; then
  echo "::warning::npm already has this version; the next step checks it is this tarball"
  exit 0
fi
exit 1
