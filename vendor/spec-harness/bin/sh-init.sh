#!/usr/bin/env bash
# sh-init.sh — compatibility entry point for safe new-project staging.
set -u

SYS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [ "$#" -ne 2 ]; then
  echo "usage: sh-init.sh <existing-target-dir> <project-name>" >&2
  exit 2
fi

exec bash "$SYS_DIR/bin/sh-install.sh" --internal-new "$1" "$2"
