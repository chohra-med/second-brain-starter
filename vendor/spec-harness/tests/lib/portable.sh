#!/usr/bin/env bash
# Shared helpers for the contract tests. Source it; it defines functions only and writes nothing.
# - require_tools NAME...: names a missing prerequisite as "missing tool: NAME" and exits 1, so a
#   missing tool is never reported as a content failure.
# - require_python311: the same for python3 older than 3.11.
# - sha256_file FILE: prints the hex SHA-256 of FILE.
# - sha256_lines FILE...: prints "<hex>  <path>" per file, like shasum -a 256 / sha256sum.
# Each hash function tries shasum -a 256, then sha256sum, then python3.

require_tools() {
  local tool missing=0
  for tool in "$@"; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      printf 'FAIL: missing tool: %s (install it or put it on PATH; no content check ran)\n' "$tool" >&2
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || exit 1
}

require_python311() {
  require_tools python3
  if ! python3 -I -B -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
    printf 'FAIL: missing tool: python3 >= 3.11 (found %s; no content check ran)\n' "$(python3 -I -B -c 'import platform; print(platform.python_version())' 2>/dev/null || echo unknown)" >&2
    exit 1
  fi
}

sha256_lines() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$@"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -I -B -c 'import hashlib, sys
for name in sys.argv[1:]:
    with open(name, "rb") as handle:
        print(hashlib.sha256(handle.read()).hexdigest() + "  " + name)' "$@"
  else
    printf 'FAIL: missing tool: shasum, sha256sum or python3 (needed for SHA-256)\n' >&2
    return 127
  fi
}

sha256_file() {
  local line
  line="$(sha256_lines "$1")" || return $?
  printf '%s\n' "${line%% *}"
}
