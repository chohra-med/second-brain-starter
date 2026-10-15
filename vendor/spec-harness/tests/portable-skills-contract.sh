#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
PORTABLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib/portable.sh"
# shellcheck source=lib/portable.sh
. "$PORTABLE"
require_tools bash
require_python311
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-portable-skills.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
CLI="$ROOT/bin/spec-harness"
# The method list has one owner: the installer's loop in bin/sh-install.sh. The generator's loop in
# bin/sh-make-skills.sh must name the same methods. Both are read here, so a method dropped from
# either loop fails by name instead of silently shrinking this contract.
method_loop() {
  local lines
  lines="$(grep -E '^for method in ponytail .*; do$' "$1")" || { echo "no method loop found in $1" >&2; exit 1; }
  [ "$(printf '%s\n' "$lines" | wc -l | tr -d ' ')" -eq 1 ] || { echo "expected exactly one method loop in $1" >&2; exit 1; }
  printf '%s\n' "$lines" | sed -e 's/^for method in //' -e 's/; do$//'
}
INSTALLER_METHODS="$(method_loop "$ROOT/bin/sh-install.sh")"
GENERATOR_METHODS="$(method_loop "$ROOT/bin/sh-make-skills.sh")"
[ "$INSTALLER_METHODS" = "$GENERATOR_METHODS" ] || { echo "method lists differ: bin/sh-install.sh [$INSTALLER_METHODS] vs bin/sh-make-skills.sh [$GENERATOR_METHODS]" >&2; exit 1; }
read -r -a METHODS <<<"$INSTALLER_METHODS"
test "${#METHODS[@]}" -gt 0 || { echo "no methods derived from bin/sh-install.sh" >&2; exit 1; }

for method in "${METHODS[@]}"; do
  owner="$ROOT/commands/$method.md"
  claude="$ROOT/skills/spec-harness-$method/SKILL.md"
  test -s "$owner" || { echo "missing method owner: $owner" >&2; exit 1; }
  test -s "$claude" || { echo "missing Claude route: $claude" >&2; exit 1; }
  grep -Fq "commands/spec-harness/$method.md" "$claude" || { echo "Claude route misses owner: $method" >&2; exit 1; }
  grep -Fq 'before a synthesis receipt or feature goal exists' "$claude" || { echo "route adds pre-init gate: $method" >&2; exit 1; }
  ! grep -Fq '.init-synthesis.json' "$claude" || { echo "standalone route requires receipt: $method" >&2; exit 1; }
done

# Generated skill text carries no em dash (U+2014): the generator emits the separators, so the check reads the output.
em_dash=$'\xe2\x80\x94'
em_rc=0
em_hits="$(grep -rl --include=SKILL.md -- "$em_dash" "$ROOT/skills")" || em_rc=$?
[ "$em_rc" -ne 2 ] || { echo "grep failed while scanning $ROOT/skills for U+2014" >&2; exit 1; }
if [ "$em_rc" -eq 0 ]; then
  echo "generated skill text contains an em dash (U+2014) in:" >&2
  echo "$em_hits" >&2
  exit 1
fi

python3 -I -B - "$ROOT/commands/init.md" "$ROOT/bin/sh-gen-agents.sh" "$ROOT/README.md" <<'PY'
from pathlib import Path
import re, sys
init, workorder, readme = (Path(x).read_text() for x in sys.argv[1:])
init_block = init.split("## Synthesis procedure\n", 1)[1].split("\n## Status contract", 1)[0]
init_steps = [(int(n), body.strip()) for n, body in re.findall(r"^(\d+)\. (.*)$", init_block, re.M)]
assert [n for n, _ in init_steps] == list(range(1, 10)), "init steps are not uniquely consecutive 1-9"
assert [n for n, _ in init_steps if "Read before deriving" in _] == [2], "init must inspect source before method selection"
assert [n for n, _ in init_steps if "Apply the reusable methods" in _] == [3], "init method selection must follow source inspection"
assert [n for n, _ in init_steps if "Derive package rules" in _] == [4]
body = workorder.split("## Execute in this order\n", 1)[1].split("\n\nA passing --check", 1)[0]
work_steps = [(int(n), text.strip()) for n, text in re.findall(r"^(\d+)\. (.*)$", body, re.M)]
assert [n for n, _ in work_steps] == list(range(9)), "work-order steps are not uniquely consecutive 0-8"
assert [n for n, _ in work_steps if "Read the target's" in _] == [1], "work order must read target instructions first"
assert [n for n, _ in work_steps if "Open the actual representative source files" in _] == [2], "work order must inspect real source before methods"
assert [n for n, _ in work_steps if "After steps 1-2, apply relevant reusable methods" in _] == [3], "work order method selection must follow source inspection"
for token in ("AGENTS.md", "RULES.md", "CONTRIBUTING.md", "ai_rules/globalRules.md", "ai_rules/rules/frequent_rules.md", "ai_rules/context_map.md", "ai_rules/project_inventory.json", ".memory/", ".cursor/rules/", ".agents/", "README.md"):
    assert token in work_steps[1][1], f"work order omits target context path: {token}"
assert "actual representative source files" in work_steps[2][1] and "relevant tests/config" in work_steps[2][1]
for label, text in (("init", init), ("work order", workorder)):
    assert "does not independently support the claim" in text, f"{label} readiness polarity is inverted"
    assert "cannot be read" in text and "no independent review context is available" in text, f"{label} lost a PENDING case"
    assert "or independently supports the claim" not in text, f"{label} retains the inverted readiness condition"
for name in ("spec-harness-ponytail", "spec-harness-grill-me", "spec-harness-package-finder", "spec-harness-skill-finder"):
    assert f"`{name}`" in readme, f"README omits exact skill identifier: {name}"
assert ".claude/skills/" in readme and ".agents/skills/" in readme and "Native discovery remains" in readme
PY

skill_hash_map() {
  (cd "$1" && find . -type f -name SKILL.md -print0 | sort -z | xargs -0 bash -c '. "$0"; sha256_lines "$@"' "$PORTABLE")
}
source_before="$(skill_hash_map "$ROOT/skills")"
GENERATOR_COPY="$TMP/generator-copy"
mkdir -p "$GENERATOR_COPY/bin" "$GENERATOR_COPY/skills"
cp "$ROOT/bin/sh-make-skills.sh" "$GENERATOR_COPY/bin/sh-make-skills.sh"
cp -R "$ROOT/skills/." "$GENERATOR_COPY/skills/"
skill_hash_map "$GENERATOR_COPY/skills" >"$TMP/generator-before.sha"
bash "$GENERATOR_COPY/bin/sh-make-skills.sh" >/dev/null
skill_hash_map "$GENERATOR_COPY/skills" >"$TMP/generator-first.sha"
python3 -I -B - "$TMP/generator-before.sha" "$TMP/generator-first.sha" "$GENERATOR_COPY/skills/spec-harness-ponytail/SKILL.md" <<'PY'
from pathlib import Path
import sys
before = {line.split(None, 1)[1].removeprefix('./'): line.split(None, 1)[0] for line in Path(sys.argv[1]).read_text().splitlines()}
after = {line.split(None, 1)[1].removeprefix('./'): line.split(None, 1)[0] for line in Path(sys.argv[2]).read_text().splitlines()}
assert len(before) == len(after) == 20, f"expected 20 generated skill files, got {len(before)} and {len(after)}"
round3 = {
    "spec-harness/SKILL.md": "335ca8be1300fe8ad5f3320ab32a6dd91e08a9bc51e24677ac62e723a6230e54",
    "spec-harness-audit/SKILL.md": "0b6c32a2e499f310bbdfe14543c505574e0e779b3f6ef245a163d1ef335df96e",
    "spec-harness-build/SKILL.md": "9cb6640b565b9a0009720135a79636788e81ecf23c352d8434bc6b83533ae6e1",
    "spec-harness-generate-agents/SKILL.md": "94cf46ef8d203b47b6afaae6fbb1ac2afb7f97aa5a6c48f258dc28e6805f3d6a",
    "spec-harness-grill-me/SKILL.md": "718137de87532b69c6a9478d9d21c002e30a8c31ed57c2570b03499e7c553c6d",
    "spec-harness-install/SKILL.md": "39cc29c93730ef89e5700345da7ded70d08b7a9f9f6d26a458c89530cd6046cd",
    "spec-harness-learn/SKILL.md": "60b548fc0ce07e765c7b08a74bdaea79c8a0c9e8587e308efe40a3b00d18b54c",
    "spec-harness-package-finder/SKILL.md": "978625d7a5042741985062d3a19b0fe2465e2e5973343b243e78cba7bffa7514",
    "spec-harness-plan/SKILL.md": "bf3a2ffdd27083f8cf0e35022b7e809363c6600ec58fef8679b6765c162ff5fd",
    "spec-harness-ponytail/SKILL.md": "bbd3c11de689bd0b7fedf98e50b67d28153074ba577841e913c2812080b4443b",
    "spec-harness-rules/SKILL.md": "158cdd51adc0cedda88df602709b57e4587c7212f4260f68144de31b5b9f79dc",
    "spec-harness-skill-finder/SKILL.md": "eec1198e5045fa5184993f7fb28704895290c52a36772ca909ccf91824caf095",
    "spec-harness-spec/SKILL.md": "a29ddfaffd693515c18d40276a9e21c07fc45ec2b2efbafca4ab1f794d752d55",
    "spec-harness-teach/SKILL.md": "1f7d01f3275370d7348d957e0d5df7280a7dddebf0f45bd7e5135159356006ac",
    "spec-harness-tasks/SKILL.md": "f66dfe9fe20033beb0a813de35eb863574b068a40f931ac16a6a6f283aae9ab4",
    "spec-harness-tester/SKILL.md": "3682f43525470837a5f43447316eefa316eb7b291ca829201a986f5464726c1e",
    "spec-harness-tickets/SKILL.md": "03ddee75207191baa675272fb83cd9046aaac7422f9f3ce8430f915c9a46ca39",
    "spec-harness-verify/SKILL.md": "bb80fc7a80e4afb0102308f22044121361fa3c1734d2973320c5a251b0d1abc3",
}
# Two method adapters were added after round 3 (conventions, technology profiles); they are frozen too.
added = {
    "spec-harness-conventions/SKILL.md": "1569ea984ed5bc9e6acdebaf4106c06b02fd11514b500eac19acec4488097840",
    "spec-harness-technology-profiles/SKILL.md": "55da510c4e8b61cf5e034fbc6cef6460e91eae78b3b3f5cff9b3973e7c6e9527",
}
assert set(round3) | set(added) == set(before) == set(after), "generated skill path set differs from frozen round 3 plus the two added methods"
for path, digest in added.items():
    assert after[path] == digest, f"added method adapter changed: {path}"
trigger = Path(sys.argv[3]).read_text().splitlines()[2]
assert "implementation work" in trigger and "code" in trigger, "generated Ponytail trigger omits implementation/code work"
# round3 is the frozen generated-skill map. A deliberate generator change moves it in the same commit.
# 2026-10-14: the generator's em dashes became ':' or '.', so the entries were re-frozen from the new output.
changed = sorted(path for path in round3 if round3[path] != after[path])
assert changed == [], f"generated skill text differs from frozen round 3: {changed}"
assert not any("Malik" in (Path(sys.argv[3]).parents[1] / path).read_text() for path in round3), "generated skill names the author"
for path in round3:
    assert before[path] == after[path], f"isolated regeneration changed source adapter bytes: {path}"
PY
bash "$GENERATOR_COPY/bin/sh-make-skills.sh" >/dev/null
skill_hash_map "$GENERATOR_COPY/skills" >"$TMP/generator-second.sha"
cmp -s "$TMP/generator-first.sha" "$TMP/generator-second.sha" || { echo 'skill generator was not stable in isolated copy' >&2; exit 1; }
source_after="$(skill_hash_map "$ROOT/skills")"
test "$source_before" = "$source_after" || { echo 'generator probe changed source-root skills' >&2; exit 1; }

for mode in new integrate; do
  target="$TMP/$mode"
  mkdir -p "$target"
  "$CLI" install "$target" "$mode" >"$TMP/$mode.log"
  for method in "${METHODS[@]}"; do
    for rel in ".claude/commands/spec-harness/$method.md" ".claude/skills/spec-harness-$method/SKILL.md" ".agents/skills/spec-harness-$method/SKILL.md"; do
      test -s "$target/$rel" || { echo "missing installed route or owner: $rel" >&2; exit 1; }
    done
    grep -Fq ".claude/commands/spec-harness/$method.md" "$target/.agents/skills/spec-harness-$method/SKILL.md"
    grep -Fq ".claude/commands/spec-harness/$method.md" "$target/.claude/skills/spec-harness-$method/SKILL.md"
  done
  python3 -I -B - "$target" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1])
build = (root / ".claude/commands/spec-harness/build.md").read_text()
implementer = (root / ".claude/agents/sdd-implementer.md").read_text()
owner = (root / ".claude/commands/spec-harness/ponytail.md").read_text()
claude = (root / ".claude/skills/spec-harness-ponytail/SKILL.md").read_text()
codex = (root / ".agents/skills/spec-harness-ponytail/SKILL.md").read_text()
assert "# Method: Ponytail" in owner, "installed Ponytail owner content is missing"
for route in (build, implementer):
    assert ".claude/commands/spec-harness/ponytail.md" in route, "installed implementation path omits Ponytail owner"
    assert "commands/ponytail.md" in route, "source-checkout fallback omits Ponytail owner"
assert "actual target source and tests" in build and "before edits" in build, "build handoff does not pass Ponytail after source review and before edits"
assert "Before editing, read the Ponytail owner" in implementer, "fresh implementer startup omits Ponytail owner"
assert "implementation work" in claude.splitlines()[2] and "implementation work" in codex.splitlines()[2], "installed Ponytail adapter trigger omits implementation"
PY
  "$CLI" install "$target" "$mode" >"$TMP/$mode-rerun.log"
  for method in "${METHODS[@]}"; do
    grep -Fq ".agents/skills/spec-harness-$method/SKILL.md" "$TMP/$mode-rerun.log"
  done
done

work_target="$TMP/work-order"
mkdir -p "$work_target"
"$CLI" install "$work_target" integrate >/dev/null
"$CLI" index "$work_target" >/dev/null
bash "$ROOT/bin/sh-gen-agents.sh" "$work_target" >/dev/null
prompt="$work_target/.claude/agents/.generate-agents.prompt.md"
test -s "$prompt"
for path in AGENTS.md RULES.md CONTRIBUTING.md ai_rules/globalRules.md ai_rules/rules/frequent_rules.md ai_rules/context_map.md .memory/ .cursor/rules/ .agents/ README.md; do
  grep -Fq "$path" "$prompt"
done
grep -Fq 'Open the actual representative source files' "$prompt"
grep -Fq 'After steps 1-2, apply relevant reusable methods' "$prompt"
python3 -I -B - "$prompt" "$ROOT" <<'PY'
from pathlib import Path
import re, sys
text=Path(sys.argv[1]).read_text()
body=text.split("## Execute in this order\n",1)[1].split("\n\nA passing --check",1)[0]
steps=[(int(n),line) for n,line in re.findall(r"^(\d+)\. (.*)$",body,re.M)]
assert [n for n,_ in steps] == list(range(9)), "staged work-order numbering must be unique and consecutive 0-8"
assert "ai_rules/globalRules.md" in steps[1][1]
assert "AGENTS.md" in steps[1][1] and ".memory/" in steps[1][1] and ".agents/" in steps[1][1]
assert "actual representative source files" in steps[2][1]
assert "After steps 1-2, apply relevant reusable methods" in steps[3][1]
# Every method owner step 3 names must ship on this branch: a work order that names a missing file
# sends the agent to a file that is not there.
owners = re.findall(r"`([A-Za-z0-9_.-]+\.md)`", steps[3][1])
missing = [name for name in owners if not (Path(sys.argv[2]) / "commands" / name).is_file()]
assert owners and not missing, f"work-order step 3 names owner files absent from commands/: {missing}"
PY

custom="$TMP/custom"
mkdir -p "$custom"
"$CLI" install "$custom" integrate >/dev/null
for client in .claude .agents; do
  rel="$client/skills/spec-harness-grill-me/SKILL.md"
  printf 'user custom bytes\n' >"$custom/$rel"
  before_hash="$(sha256_file "$custom/$rel")"
  "$CLI" install "$custom" integrate >"$TMP/custom.log"
  after_hash="$(sha256_file "$custom/$rel")"
  test "$before_hash" = "$after_hash"
  grep -Fq "$rel" "$TMP/custom.log"
done

for kind in symlink directory; do
  target="$TMP/collision-$kind"
  outside="$TMP/outside-$kind"
  mkdir -p "$target" "$outside"
  rel=.agents/skills/spec-harness-skill-finder/SKILL.md
  mkdir -p "$(dirname "$target/$rel")"
  if [ "$kind" = symlink ]; then ln -s "$outside" "$target/$rel"; else mkdir -p "$target/$rel"; fi
  if "$CLI" install "$target" integrate >"$TMP/collision-$kind.log" 2>&1; then
    echo "$kind collision unexpectedly accepted" >&2; exit 1
  fi
  test ! -e "$target/AGENTS.md"
  test -z "$(find "$outside" -mindepth 1 -print -quit)"
done

echo "PASS: ${#METHODS[@]} method owners, pre-init thin routes, generator stability, new/integrate/rerun, preservation and collision preflight"
