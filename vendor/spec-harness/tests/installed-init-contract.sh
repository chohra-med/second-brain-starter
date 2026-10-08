#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-installed-init.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
CACHE="$TMP/npm-cache"
PACK="$TMP/pack"
CONSUMER="$TMP/consumer"
mkdir -p "$PACK" "$CONSUMER"
(cd "$ROOT" && npm_config_cache="$CACHE" npm pack --ignore-scripts --pack-destination "$PACK" >"$TMP/pack.txt" 2>"$TMP/pack.err")
TARBALL="$PACK/$(cat "$TMP/pack.txt")"
npm_config_cache="$CACHE" npm install --prefix "$CONSUMER" --ignore-scripts "$TARBALL" >"$TMP/install.log" 2>&1
TARGET="$TMP/target"
mkdir -p "$TARGET"
CLI="$CONSUMER/node_modules/.bin/spec-harness"
"$CLI" install "$TARGET" integrate >"$TMP/init.log"
for method in architecture performance packages; do
  test -f "$TARGET/.claude/spec-harness/methods/spec-harness-$method.md"
  test ! -e "$TARGET/.claude/skills/spec-harness-$method/SKILL.md"
done
for method in ponytail grill-me package-finder skill-finder; do
  test -f "$TARGET/.claude/commands/spec-harness/$method.md"
  test -f "$TARGET/.claude/skills/spec-harness-$method/SKILL.md"
  test -f "$TARGET/.agents/skills/spec-harness-$method/SKILL.md"
  grep -Fq ".claude/commands/spec-harness/$method.md" "$TARGET/.claude/skills/spec-harness-$method/SKILL.md"
  grep -Fq ".claude/commands/spec-harness/$method.md" "$TARGET/.agents/skills/spec-harness-$method/SKILL.md"
done
"$CLI" index "$TARGET" >"$TMP/index.log"
"$CONSUMER/node_modules/spec-harness/bin/sh-gen-agents.sh" "$TARGET" >"$TMP/workorder.log"
for doc in init rules generate-agents; do test -f "$TARGET/.claude/commands/spec-harness/$doc.md"; done
grep -Fq ".claude/spec-harness/methods/" "$TARGET/.claude/agents/.generate-agents.prompt.md"
for method in architecture performance packages; do grep -Fq "spec-harness-$method" "$TARGET/.claude/agents/.generate-agents.prompt.md"; done
grep -Fq 'spec-harness index <target>' "$TARGET/.claude/agents/.generate-agents.prompt.md"
! grep -Eq 'Read `commands/(init|rules|generate-agents)\.md`|source procedures' "$TARGET/.claude/agents/.generate-agents.prompt.md"
# A custom reserved project-skill name is preserved and explicitly left pending.
CUSTOM="$TMP/custom-target"
mkdir -p "$CUSTOM/.claude/skills/spec-harness-performance"
printf 'custom bytes\n' >"$CUSTOM/.claude/skills/spec-harness-performance/SKILL.md"
BEFORE="$(shasum -a 256 "$CUSTOM/.claude/skills/spec-harness-performance/SKILL.md" | cut -d ' ' -f1)"
"$CLI" install "$CUSTOM" integrate >"$TMP/custom.log"
AFTER="$(shasum -a 256 "$CUSTOM/.claude/skills/spec-harness-performance/SKILL.md" | cut -d ' ' -f1)"
test "$BEFORE" = "$AFTER"
grep -Fq '.claude/skills/spec-harness-performance/SKILL.md (reserved project skill already exists; preserve and report CONFLICT/PENDING during init)' "$TMP/custom.log"
# A legacy generic skill from the collision version is preserved and kept pending.
LEGACY="$TMP/legacy-target"
mkdir -p "$LEGACY/.claude/skills/spec-harness-architecture"
cp "$ROOT/templates/project-skills/spec-harness-architecture.md" "$LEGACY/.claude/skills/spec-harness-architecture/SKILL.md"
BEFORE="$(shasum -a 256 "$LEGACY/.claude/skills/spec-harness-architecture/SKILL.md" | cut -d ' ' -f1)"
"$CLI" install "$LEGACY" integrate >"$TMP/legacy.log"
AFTER="$(shasum -a 256 "$LEGACY/.claude/skills/spec-harness-architecture/SKILL.md" | cut -d ' ' -f1)"
test "$BEFORE" = "$AFTER"
grep -Fq '.claude/skills/spec-harness-architecture/SKILL.md (reserved project skill already exists; preserve and report CONFLICT/PENDING during init)' "$TMP/legacy.log"
# A method destination symlink is rejected before target files are staged.
LINK="$TMP/link-target"
OUTSIDE="$TMP/outside"
mkdir -p "$LINK/.claude/spec-harness/methods" "$OUTSIDE"
ln -s "$OUTSIDE" "$LINK/.claude/spec-harness/methods/spec-harness-performance.md"
if "$CLI" install "$LINK" integrate >"$TMP/link.log" 2>&1; then
  echo 'FAIL: method destination symlink accepted' >&2; exit 1
fi
test -z "$(find "$OUTSIDE" -mindepth 1 -print -quit)"
test ! -e "$LINK/AGENTS.md"
printf 'PASS: packed installed init route, 3 method paths, no reserved generic skills, custom conflict preservation, method symlink preflight\n'
