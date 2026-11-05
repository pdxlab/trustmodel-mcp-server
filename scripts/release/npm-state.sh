#!/usr/bin/env bash
# TRUS-2500: what npm holds for <package>@<version>, compared with our tarball's
# sha1 (npm's dist.shasum).
#
#   stdout "absent", exit 0   npm answered E404: not published
#   stdout "same",   exit 0   npm has exactly our bytes
#   exit 2                    npm has different bytes under this version
#   exit 1                    anything else (network, auth, odd output)
#
# Exit 1 is never read as "absent": the node SDK's release did that, and a re-run
# then tried to publish a version npm already had (TRUS-2495).
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <package> <version> <expected-shasum>" >&2
  exit 1
fi
pkg=$1 version=$2 expected=$3

err=$(mktemp)
trap 'rm -f "$err"' EXIT

if live=$(npm view "$pkg@$version" dist.shasum --prefer-online 2>"$err"); then
  if [ "$live" = "$expected" ]; then
    echo same
    exit 0
  fi
  if [ -z "$live" ]; then
    echo "::error::npm view $pkg@$version succeeded but returned no shasum" >&2
    cat "$err" >&2
    exit 1
  fi
  echo "::error::$pkg@$version is on npm with shasum $live, not $expected" >&2
  exit 2
fi

if grep -q 'E404' "$err"; then
  echo absent
  exit 0
fi
echo "::error::npm view $pkg@$version failed:" >&2
cat "$err" >&2
exit 1
