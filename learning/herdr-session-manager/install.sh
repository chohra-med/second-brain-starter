#!/usr/bin/env bash
# install.sh <target-folder>: copy the master workflow kit into a second-brain folder. Never overwrites a file that exists.
set -u
SRC="$(cd "$(dirname "$0")" && pwd)"; DEST="${1:-}"
[ -d "$DEST" ] || { echo "usage: bash install.sh <existing target folder>" >&2; exit 1; }
n=0; skipped=0
for f in .claude/commands/master.md .claude/commands/end-session.md employees/_template.md employees/researcher.md employees/writer.md \
         scripts/dispatch.sh scripts/dispatch-selftest.sh scripts/board.py fixtures/pane-working-t1.txt fixtures/pane-working-t2.txt \
         state/sessions.tsv state/decisions.md tasks/launch-post-2026-01-12.md reports/.gitkeep research/.gitkeep drafts/.gitkeep; do
  if [ -e "$DEST/$f" ]; then echo "skip (exists): $f"; skipped=$((skipped+1)); continue; fi
  mkdir -p "$DEST/$(dirname "$f")"; cp -p "$SRC/$f" "$DEST/$f"; echo "copied: $f"; n=$((n+1))
done
echo "done: $n copied, $skipped skipped. Next: cd $DEST && bash scripts/dispatch-selftest.sh"
