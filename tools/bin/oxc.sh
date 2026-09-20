#!/bin/sh
# ponytail: ocx.sh/oxc-project/{oxlint,oxfmt} publish the binary under its Rust
# target-triple name (e.g. oxlint-x86_64-unknown-linux-musl) instead of the
# short one — a metadata bug in the ocx.sh package, not this repo. Resolve by
# PATH prefix instead of hardcoding an architecture, so this keeps working on
# arm64 too. Drop this wrapper once ocx.sh fixes the package metadata and
# `oxlint`/`oxfmt` resolve directly.
set -eu
tool=$1
shift
bin=$(command -v "$tool" 2>/dev/null || true)
if [ -z "$bin" ]; then
  IFS=:
  for dir in $PATH; do
    for candidate in "$dir/$tool"-*; do
      if [ -x "$candidate" ] && [ ! -d "$candidate" ]; then
        bin=$candidate
        break 2
      fi
    done
  done
fi
if [ -z "$bin" ]; then
  echo "oxc.sh: '$tool' not found on PATH (run via 'ocx exec --')" >&2
  exit 127
fi
exec "$bin" "$@"
