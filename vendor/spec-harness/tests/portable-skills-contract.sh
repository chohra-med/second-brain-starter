#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-portable-skills.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
CLI="$ROOT/bin/spec-harness"
METHODS=(ponytail grill-me package-finder skill-finder)

for method in "${METHODS[@]}"; do
  owner="$ROOT/commands/$method.md"
  claude="$ROOT/skills/spec-harness-$method/SKILL.md"
  test -s "$owner" || { echo "missing method owner: $owner" >&2; exit 1; }
  test -s "$claude" || { echo "missing Claude route: $claude" >&2; exit 1; }
  grep -Fq "commands/spec-harness/$method.md" "$claude" || { echo "Claude route misses owner: $method" >&2; exit 1; }
  grep -Fq 'before a synthesis receipt or feature goal exists' "$claude" || { echo "route adds pre-init gate: $method" >&2; exit 1; }
  ! grep -Fq '.init-synthesis.json' "$claude" || { echo "standalone route requires receipt: $method" >&2; exit 1; }
done

python3 - "$ROOT/commands/init.md" "$ROOT/bin/sh-gen-agents.sh" "$ROOT/README.md" <<'PY'
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
for token in ("AGENTS.md", "RULES.md", "CONTRIBUTING.md", "ai_rules/globalRules.md", "ai_rules/rules/frequent_rules.md", "ai_rules/context_map.md", "ai_rules/project_inventory.json", ".memory/", ".cursor/rules/", ".Codex/", "README.md"):
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
  (cd "$1" && find . -type f -name SKILL.md -print0 | sort -z | xargs -0 shasum -a 256)
}
source_before="$(skill_hash_map "$ROOT/skills")"
GENERATOR_COPY="$TMP/generator-copy"
mkdir -p "$GENERATOR_COPY/bin" "$GENERATOR_COPY/skills"
cp "$ROOT/bin/sh-make-skills.sh" "$GENERATOR_COPY/bin/sh-make-skills.sh"
cp -R "$ROOT/skills/." "$GENERATOR_COPY/skills/"
skill_hash_map "$GENERATOR_COPY/skills" >"$TMP/generator-before.sha"
bash "$GENERATOR_COPY/bin/sh-make-skills.sh" >/dev/null
skill_hash_map "$GENERATOR_COPY/skills" >"$TMP/generator-first.sha"
python3 - "$TMP/generator-before.sha" "$TMP/generator-first.sha" "$GENERATOR_COPY/skills/spec-harness-ponytail/SKILL.md" <<'PY'
from pathlib import Path
import sys
before = {line.split(None, 1)[1].removeprefix('./'): line.split(None, 1)[0] for line in Path(sys.argv[1]).read_text().splitlines()}
after = {line.split(None, 1)[1].removeprefix('./'): line.split(None, 1)[0] for line in Path(sys.argv[2]).read_text().splitlines()}
assert len(before) == len(after) == 17, f"expected 17 generated skill files, got {len(before)} and {len(after)}"
round3 = {
    "spec-harness/SKILL.md": "c39b29ff07882181889ccf45ddc9277390eb14310c13dd87437ae8c80ff9439c",
    "spec-harness-audit/SKILL.md": "14b1665378052322304c54ce361874f7260577305c30d648ffa8acca80331260",
    "spec-harness-build/SKILL.md": "b84b2644d7a50ceea0e484595e80df178c310a591c5d7b5e17dd6d4982a26514",
    "spec-harness-generate-agents/SKILL.md": "133d3176754891cb564d9a98359c8047ca4edcb782f490cb3590f85b4a58c505",
    "spec-harness-grill-me/SKILL.md": "56c9456dd72a7a891caf1c8005bb1c6e7d72c47327c48fe067a87a4c1a351b5d",
    "spec-harness-install/SKILL.md": "22eb66c8f35a76865a6ed43b69b1dee64186a1b8c83f1627482cc853f40ff299",
    "spec-harness-learn/SKILL.md": "7416fb371c9a5403559f10e5a7491af839adcc5de1f17dffd2335ce7f5c36eaf",
    "spec-harness-package-finder/SKILL.md": "607aea125a03c183129e060935e2b9f276abfcba16e3cb7e5fec4a9d2ab62c29",
    "spec-harness-plan/SKILL.md": "182eb91bbd1c9dca573be12b9fe39d3084aef992334f01a0a911ce9664908f46",
    "spec-harness-ponytail/SKILL.md": "909698a392cf2944a0aadc18b2604337b104c1bfaf1515caf3ffebe64b345ab7",
    "spec-harness-rules/SKILL.md": "c0fe5440b06f56d453f7ed6794a73dc925e0c0e1ffca88144a491646a063e0cb",
    "spec-harness-skill-finder/SKILL.md": "b8a8e214bc373cceb3dde9bb6f670291689febffb520454f428baf868bba3f8d",
    "spec-harness-spec/SKILL.md": "9efebaf5e6b8da7bb3fd7f2db6f87675782514c59f1f5e5cbfc984d173625879",
    "spec-harness-tasks/SKILL.md": "4281604563197c18caec9fd15a8da8bffe3b17b99bb8c7364ce8744318478925",
    "spec-harness-tester/SKILL.md": "cb0f67b79df0cbe198e5e433159ad3f281530ca65645298bac2d7d6451fbe864",
    "spec-harness-tickets/SKILL.md": "bf7621458e57b06f4f0d45a99a68bc983d8c88cdeca2b43253d298202837ac83",
    "spec-harness-verify/SKILL.md": "923884a42ba9d6408178be1e2bb2b4dffa0115bc2dc95078d020e63abc1f15c7",
}
assert set(round3) == set(before) == set(after), "generated skill path set differs from frozen round 3"
trigger = Path(sys.argv[3]).read_text().splitlines()[2]
assert "implementation work" in trigger and "code" in trigger, "generated Ponytail trigger omits implementation/code work"
changed = sorted(path for path in after if round3[path] != after[path])
# The four method adapters stay frozen. Every command skill deviates since its trigger text
# says "the user" instead of naming the author; install also gained technology skills.
frozen = ["spec-harness-grill-me/SKILL.md", "spec-harness-package-finder/SKILL.md", "spec-harness-skill-finder/SKILL.md"]
assert changed == sorted(set(round3) - set(frozen)), f"unexpected historical skill deviations: {changed}"
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
  python3 - "$target" <<'PY'
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
for path in AGENTS.md RULES.md CONTRIBUTING.md ai_rules/globalRules.md ai_rules/rules/frequent_rules.md ai_rules/context_map.md .memory/ .cursor/rules/ .Codex/ README.md; do
  grep -Fq "$path" "$prompt"
done
grep -Fq 'Open the actual representative source files' "$prompt"
grep -Fq 'After steps 1-2, apply relevant reusable methods' "$prompt"
python3 - "$prompt" <<'PY'
from pathlib import Path
import re, sys
text=Path(sys.argv[1]).read_text()
body=text.split("## Execute in this order\n",1)[1].split("\n\nA passing --check",1)[0]
steps=[(int(n),line) for n,line in re.findall(r"^(\d+)\. (.*)$",body,re.M)]
assert [n for n,_ in steps] == list(range(9)), "staged work-order numbering must be unique and consecutive 0-8"
assert "ai_rules/globalRules.md" in steps[1][1]
assert "AGENTS.md" in steps[1][1] and ".memory/" in steps[1][1] and ".Codex/" in steps[1][1]
assert "actual representative source files" in steps[2][1]
assert "After steps 1-2, apply relevant reusable methods" in steps[3][1]
PY

custom="$TMP/custom"
mkdir -p "$custom"
"$CLI" install "$custom" integrate >/dev/null
for client in .claude .agents; do
  rel="$client/skills/spec-harness-grill-me/SKILL.md"
  printf 'user custom bytes\n' >"$custom/$rel"
  before_hash="$(shasum -a 256 "$custom/$rel" | awk '{print $1}')"
  "$CLI" install "$custom" integrate >"$TMP/custom.log"
  after_hash="$(shasum -a 256 "$custom/$rel" | awk '{print $1}')"
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

echo 'PASS: four method owners, pre-init thin routes, generator stability, new/integrate/rerun, preservation and collision preflight'
