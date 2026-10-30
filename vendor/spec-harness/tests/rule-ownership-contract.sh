#!/usr/bin/env bash
# Rule-ownership contract: commands/init.md is the only owner of the first-initialization,
# guarded-refresh and CONFLICT/PENDING rules. Each key phrase must be PRESENT in the owner and
# must NOT appear in the work order (bin/sh-gen-agents.sh), the generator (bin/sh-make-skills.sh)
# or commands/sdd.md. Those files point to the owner; they do not restate it.
# Usage: rule-ownership-contract.sh [root]   (root defaults to this repository; a temp copy is a valid root)
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd -P)}"
OWNER=commands/init.md
OTHERS=(bin/sh-gen-agents.sh bin/sh-make-skills.sh commands/sdd.md)
PHRASES=(
  "create a skill only when its name is absent"
  "reuse or refresh an existing skill"
  "no custom edit intervened"
  "exact preimage"
  "A receipt hash is not write authority"
  "preserve its bytes and report \`CONFLICT/PENDING\`"
)

for file in "$OWNER" "${OTHERS[@]}"; do
  [ -f "$ROOT/$file" ] || { echo "FAIL: missing $file under $ROOT"; exit 1; }
done

status=0
for phrase in "${PHRASES[@]}"; do
  if ! grep -Fq -- "$phrase" "$ROOT/$OWNER"; then
    echo "FAIL: owner $OWNER does not contain phrase \"$phrase\""
    status=1
  fi
  for file in "${OTHERS[@]}"; do
    if grep -Fq -- "$phrase" "$ROOT/$file"; then
      echo "FAIL: phrase \"$phrase\" appears in $file; its owner is $OWNER"
      status=1
    fi
  done
done

if [ "$status" -eq 0 ]; then
  echo "PASS: every first-initialization, refresh and CONFLICT/PENDING phrase is owned by $OWNER alone"
fi
exit "$status"
