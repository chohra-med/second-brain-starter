#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HARNESS_DIR="$(cd "${1:-$SCRIPT_DIR/..}" && pwd -P)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sdd-fixtures.XXXXXX")" || exit 1
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM

failures=0
checks=0
packed_consumer="$TMP_DIR/clean consumer"
packed_consumer_ready=0
fail() {
  printf 'FAIL: %s\n' "$1" >&2
  failures=$((failures + 1))
}
pass() {
  printf 'PASS: %s\n' "$1"
  checks=$((checks + 1))
}
has_text() {
  local haystack=$1 needle=$2 label=$3
  if [[ "$haystack" == *"$needle"* ]]; then pass "$label"; else fail "$label (missing: $needle)"; fi
}
run_cli() {
  local label=$1 expected=$2
  shift 2
  local output status=0
  output="$(bash "$HARNESS_DIR/bin/spec-harness" "$@" 2>&1)" || status=$?
  if [[ "$status" -eq "$expected" ]]; then pass "$label exit $expected"; else fail "$label exit $status, expected $expected"; fi
  has_text "$output" "PENDING" "$label reports PENDING"
  has_text "$output" "commands/sdd.md" "$label names the manual procedure"
}

for path in \
  "$HARNESS_DIR/commands/sdd.md" \
  "$HARNESS_DIR/commands/init.md" \
  "$HARNESS_DIR/commands/rules.md" \
  "$HARNESS_DIR/commands/generate-agents.md" \
  "$HARNESS_DIR/commands/tickets.md"; do
  if [[ -f "$path" ]]; then pass "source procedure exists: ${path#"$HARNESS_DIR"/}"; else fail "missing source procedure: $path"; fi
done

for method in ponytail grill-me package-finder skill-finder; do
  owner="$HARNESS_DIR/commands/$method.md"
  route="$HARNESS_DIR/skills/spec-harness-$method/SKILL.md"
  if [[ -f "$owner" ]]; then pass "portable method owner exists: $method"; else fail "missing portable method owner: $method"; fi
  if [[ -f "$route" ]]; then
    has_text "$(cat "$route")" ".claude/commands/spec-harness/$method.md" "generated $method skill names its canonical owner"
    has_text "$(cat "$route")" 'before a synthesis receipt or feature goal exists' "$method route stays usable during init"
  else
    fail "missing generated portable method skill: $method"
  fi
done

if [[ -f "$HARNESS_DIR/commands/sdd.md" ]]; then
  sdd_text="$(cat "$HARNESS_DIR/commands/sdd.md")"
  for token in \
    'Ponytail' 'Grill Me' 'specs/<feature>/goal.md' \
    '.init-synthesis.json' 'sdd-planner' 'sdd-implementer' \
    'sdd-tester' 'sdd-verifier' 'sdd-reviewer' \
    'tester.md' 'verifier.md' 'reviewer.md' 'report-and-wait' \
    'guarded refresh' 'Before reindexing' 'receipt hash alone' \
    'invalidate stale tester, verifier and reviewer records'; do
    has_text "$sdd_text" "$token" "shared route binds $token"
  done
fi

if [[ -f "$HARNESS_DIR/commands/sdd.md" && -f "$HARNESS_DIR/commands/build.md" ]]; then
  if ! python3 - "$HARNESS_DIR/commands/sdd.md" "$HARNESS_DIR/commands/build.md" <<'PYCONTRACT'
from pathlib import Path
import sys, tempfile
sdd, build = (Path(p).read_text() for p in sys.argv[1:])
required = {
    "early class routing": "Classify after resolving ticket input",
    "all classes": "MICRO",
    "inline small-class planning": "skip a\ndelegated planner",
    "init-only bypass": "init-only work does not request ticket content or classify a ticket",
    "connected body before class": "retrieve its exact body first",
    "lite route": "LITE",
    "full high-risk route": "FULL",
    "separate mandatory goal verifier": "mandatory for\nMICRO, LITE and FULL",
    "exact evidence identity": "declared dependency identities match",
    "targeted invalidation": "invalidate only evidence tied to the affected",
    "two-round stop": "After two unsuccessful\nordinary correction rounds, stop",
    "causal diagnosis": "causal diagnosis",
    "changed bounded strategy": "changed bounded strategy",
    "manual rather than automatic reuse": "not an automatic cache or scheduler",
}
source = sdd + "\n" + build
def contract_guard(route, text):
    missing = [label for label, token in required.items() if token not in text]
    resolve_at = route.find("## 2. Resolve the ticket input")
    classify_at = route.find("## 3. Classify after resolving ticket input")
    if resolve_at < 0 or classify_at < 0 or resolve_at > classify_at:
        missing.append("connected body before class")
    return missing
assert not contract_guard(sdd, source), f"missing SDD contracts: {contract_guard(sdd, source)}"
# Positive controls: remove the init-only branch and invert body/class order; both must go RED.
init_token = required["init-only bypass"]
assert "init-only bypass" in contract_guard(sdd.replace(init_token, "[planted omission]"), source.replace(init_token, "[planted omission]")), "RED control failed to detect missing init-only branch"
print("RED control observed: missing init-only bypass rejected")
inverted = sdd.replace("## 2. Resolve the ticket input", "## TEMP. Resolve the ticket input", 1).replace("## 3. Classify after resolving ticket input", "## 2. Classify after resolving ticket input", 1).replace("## TEMP. Resolve the ticket input", "## 3. Resolve the ticket input", 1)
assert "connected body before class" in contract_guard(inverted, source), "RED control failed to detect inverted ticket-body ordering"
print("RED control observed: classification before connected-body retrieval rejected")
# Remaining omissions must also be detected before the pristine text is accepted.
for label, token in required.items():
    with tempfile.TemporaryDirectory(prefix="sdd-contract-red-") as temp:
        planted = Path(temp) / "route.md"
        planted.write_text(source.replace(token, "[planted omission]"))
        assert label in contract_guard(sdd, planted.read_text()), f"RED control failed to detect {label}"
assert not contract_guard(sdd, source), "restored route remains RED"
print("PASS SDD contract and planted omission controls (instruction-level route semantics)")
PYCONTRACT
  then fail "SDD contract and planted omission controls failed"; fi
fi

if [[ -f "$HARNESS_DIR/commands/verify.md" ]]; then
  verify_doc="$(cat "$HARNESS_DIR/commands/verify.md")"
  if [[ "$verify_doc" == *'&& git commit'* ]]; then fail 'verifier docs do not imply commit authority'; else pass 'verifier docs do not imply commit authority'; fi
  has_text "$verify_doc" 'specs/<feature>/goal.md' 'verifier selects the feature goal'
fi

if [[ -f "$HARNESS_DIR/agents/sdd-verifier.md" ]]; then
  verifier_role="$(tr '\n' ' ' <"$HARNESS_DIR/agents/sdd-verifier.md")"
  has_text "$verifier_role" 'Ticket work uses `specs/<feature>/goal.md`' 'generic verifier selects the ticket goal'
  has_text "$verifier_role" 'standalone work requires a caller-supplied' 'generic verifier requires a standalone goal path'
  has_text "$verifier_role" 'Never infer root `goal.md`' 'generic verifier never infers the root goal'
fi

if [[ -f "$HARNESS_DIR/commands/document.md" ]]; then
  document_doc="$(tr '\n' ' ' <"$HARNESS_DIR/commands/document.md")"
  has_text "$document_doc" 'explicitly selected goal' 'document guide uses the selected goal'
  has_text "$document_doc" 'PENDING handoff and exits 2' 'document guide reports shell verification as PENDING'
  has_text "$document_doc" 'does not execute verification checks' 'document guide does not imply the CLI verifies'
fi

if [[ -f "$HARNESS_DIR/commands/tickets.md" ]]; then
  tickets_doc="$(cat "$HARNESS_DIR/commands/tickets.md")"
  has_text "$tickets_doc" 'retrievable' 'ticket route requires retrieved reference contents'
  has_text "$tickets_doc" 'exact' 'ticket route preserves exact supplied text'
fi

if [[ -f "$HARNESS_DIR/commands/migrate.md" ]]; then
  migrate_doc="$(tr '\n' ' ' <"$HARNESS_DIR/commands/migrate.md")"
  if [[ "$migrate_doc" == *'does not parse source symbols'* && "$migrate_doc" == *'write README files into product source'* ]]; then
    pass 'migration guide avoids unmeasured README writes and symbol extraction'
  else
    fail 'migration guide states the indexer write and symbol-extraction limits'
  fi
fi

if [[ -f "$HARNESS_DIR/commands/ship.md" ]]; then
  ship_doc="$(tr '\n' ' ' <"$HARNESS_DIR/commands/ship.md" | sed 's/> //g')"
  has_text "$ship_doc" 'does not grant permission' 'ship guide separates evidence from delivery authority'
  has_text "$ship_doc" 'report-and-wait' 'ship guide requires explicit authority at the action boundary'
fi

for cmd in sdd tickets plan build verify; do
  if [[ "$cmd" == sdd ]]; then
    run_cli "CLI $cmd init" 2 "$cmd" init
  elif [[ "$cmd" == verify ]]; then
    run_cli "CLI $cmd" 2 "$cmd" --goal 'specs/sample/goal.md'
  else
    run_cli "CLI $cmd" 2 "$cmd"
  fi
done

if [[ -f "$HARNESS_DIR/commands/build.md" ]]; then
  build_text="$(cat "$HARNESS_DIR/commands/build.md")"
  has_text "$build_text" 'its tier resolved to in the shared SDD stage map' 'build uses the tier model map'
  if [[ "$build_text" == *'bound Luna'* ]]; then fail 'build does not hardcode Luna across providers'; else pass 'build does not hardcode Luna across providers'; fi
fi

if [[ -f "$HARNESS_DIR/skills/spec-harness/SKILL.md" ]]; then
  umbrella="$(cat "$HARNESS_DIR/skills/spec-harness/SKILL.md")"
  has_text "$umbrella" 'commands/sdd.md' 'umbrella skill points to the shared route'
else
  fail 'missing generated umbrella skill'
fi
for skill in tickets spec plan tasks build verify; do
  path="$HARNESS_DIR/skills/spec-harness-$skill/SKILL.md"
  if [[ -f "$path" ]]; then
    has_text "$(cat "$path")" 'commands/sdd.md' "generated $skill skill points to the shared route"
  else
    fail "missing generated $skill skill"
  fi
done

if ! command -v npm >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
  fail 'clean consumer check requires npm and tar'
else
  pack_log="$TMP_DIR/npm-pack.log"
  if (cd "$HARNESS_DIR" && npm_config_cache="$TMP_DIR/npm-cache" npm pack --ignore-scripts --pack-destination "$TMP_DIR" >"$pack_log" 2>&1); then
    archive="$(find "$TMP_DIR" -maxdepth 1 -type f -name '*.tgz' -print -quit)"
    if [[ -n "$archive" ]]; then
      if tar -tzf "$archive" | rg -q '^package/docs/GUARDRAILS\.md$' && tar -tzf "$archive" | rg -q '^package/docs/MCP-SERVERS\.md$'; then
        pass 'consumer package includes README-linked docs'
      else
        fail 'consumer package omits README-linked docs'
      fi
      mkdir -p "$TMP_DIR/package"
      if tar -xzf "$archive" -C "$TMP_DIR/package"; then
        consumer_source="$TMP_DIR/package/package"
        target="$packed_consumer"
        mkdir -p "$target"
        install_log="$TMP_DIR/install.log"
        if bash "$consumer_source/bin/spec-harness" install "$target" integrate >"$install_log" 2>&1; then
          packed_consumer_ready=1
          pass 'packed CLI stages a clean consumer'
          for path in \
            .claude/commands/sdd.md \
            .agents/skills/sdd/SKILL.md \
            .claude/commands/spec-harness/init.md \
            .claude/commands/spec-harness/rules.md \
            .claude/commands/spec-harness/generate-agents.md \
            .claude/commands/spec-harness/plan.md \
            .claude/commands/spec-harness/ponytail.md \
            .claude/commands/spec-harness/grill-me.md \
            .claude/commands/spec-harness/package-finder.md \
            .claude/commands/spec-harness/skill-finder.md \
            .claude/commands/spec-harness/learn.md \
            .claude/agents/sdd-planner.md \
            .claude/agents/sdd-implementer.md \
            .claude/agents/sdd-researcher.md \
            .claude/agents/sdd-tester.md \
            .claude/agents/sdd-verifier.md \
            .claude/agents/sdd-reviewer.md \
            .claude/agents/sdd-workflow-tester.md \
            .claude/commands/spec-harness/tester.md \
            .claude/skills/spec-harness-tester/SKILL.md \
            workflows/README.md; do
  if [[ -f "$target/$path" ]]; then pass "clean consumer installed $path"; else fail "clean consumer missing $path"; fi
          done
          while IFS= read -r -d '' source_skill; do
            relative_skill=${source_skill#"$consumer_source/skills/"}
            if [[ -f "$target/.claude/skills/$relative_skill" ]]; then
              pass "clean consumer installed skill $relative_skill"
            else
              fail "clean consumer missing skill $relative_skill"
            fi
          done < <(find "$consumer_source/skills" -type f -name SKILL.md -print0)
          adapter="$(cat "$target/.agents/skills/sdd/SKILL.md" 2>/dev/null || true)"
          has_text "$adapter" '.claude/commands/sdd.md' 'Codex adapter routes to installed procedure'
          for method in ponytail grill-me package-finder skill-finder; do
            codex_method="$(cat "$target/.agents/skills/spec-harness-$method/SKILL.md" 2>/dev/null || true)"
            has_text "$codex_method" ".claude/commands/spec-harness/$method.md" "Codex $method adapter names the canonical owner"
          done
          route="$(cat "$target/.claude/commands/sdd.md" 2>/dev/null || true)"
          for path in \
            .claude/commands/spec-harness/init.md \
            .claude/commands/spec-harness/rules.md \
            .claude/commands/spec-harness/plan.md \
            .claude/commands/spec-harness/learn.md \
            .claude/commands/spec-harness/generate-agents.md \
            .claude/agents/.init-synthesis.json; do
            has_text "$route" "$path" "installed shared route names $path"
          done
          installed_planner="$(cat "$target/.claude/agents/sdd-planner.md" 2>/dev/null || true)"
          installed_implementer="$(cat "$target/.claude/agents/sdd-implementer.md" 2>/dev/null || true)"
          installed_reviewer="$(cat "$target/.claude/agents/sdd-reviewer.md" 2>/dev/null || true)"
          installed_verifier="$(cat "$target/.claude/agents/sdd-verifier.md" 2>/dev/null || true)"
          installed_researcher="$(cat "$target/.claude/agents/sdd-researcher.md" 2>/dev/null || true)"
          installed_learn="$(cat "$target/.claude/commands/spec-harness/learn.md" 2>/dev/null || true)"
          installed_learn_skill="$(cat "$target/.claude/skills/spec-harness-learn/SKILL.md" 2>/dev/null || true)"
          has_text "$installed_planner" 'Then write or update `specs/<feature>/tasks.md`' 'packed planner produces tasks after the plan'
          has_text "$installed_implementer" 'Current source, tests, manifests, inventory and implementation receipt' 'packed implementer reads current source and receipt'
          has_text "$installed_reviewer" '`goal.md` and `plan.md`' 'packed reviewer reads feature goal and plan'
          has_text "$installed_verifier" 'Do not append a cause to `AGENTS.md` automatically' 'packed verifier routes FAIL through reviewed learning'
          has_text "$installed_researcher" 'not a prerequisite for ordinary ticket planning or implementation' 'packed researcher does not require design'
          has_text "$installed_learn" 'Apply only after approval' 'packed learn procedure requires review before application'
          has_text "$installed_learn_skill" 'Report LEARNED only after reviewed application' 'packed learn skill reflects reviewed application'
          if [[ "$installed_planner" == *'Use AFTER spec.md and design.md exist'* || "$installed_verifier" == *'appended to AGENTS.md as a new hard constraint'* || "$installed_learn_skill" == *'classify by package path and concern, inject into its canonical owner'* ]]; then
            fail 'packed consumer contains a superseded required role or learning instruction'
          else
            pass 'packed consumer omits superseded role and learning instructions'
          fi
          installed_cli="$(bash "$consumer_source/bin/spec-harness" sdd init 2>&1)"; installed_status=$?
          if [[ "$installed_status" -eq 2 && "$installed_cli" == *PENDING* ]]; then pass 'packed CLI exposes truthful PENDING manual handoff'; else fail "packed CLI route status=$installed_status output=$installed_cli"; fi
        else
          fail "packed CLI could not stage clean consumer: $(cat "$install_log")"
        fi
      else
        fail 'cannot extract packed consumer archive'
      fi
    else
      fail 'npm pack returned no archive'
    fi
  else
    fail "npm pack failed: $(cat "$pack_log")"
  fi
fi

if [[ -x "$HARNESS_DIR/bin/sh-install.sh" ]]; then
  target="$TMP_DIR/preservation consumer"
  mkdir -p "$target"
  if bash "$HARNESS_DIR/bin/sh-install.sh" --entrypoint install "$target" integrate >/dev/null 2>&1; then
    custom_files=(
      "$target/goal.md"
      "$target/.claude/commands/sdd.md"
      "$target/.agents/skills/sdd/SKILL.md"
    )
    printf 'user goal sentinel\n' >"${custom_files[0]}"
    printf 'user Claude route sentinel\n' >"${custom_files[1]}"
    printf 'user Codex route sentinel\n' >"${custom_files[2]}"
    before=()
    for path in "${custom_files[@]}"; do before+=("$(shasum -a 256 "$path" | awk '{print $1}')"); done
    install_log="$TMP_DIR/preservation-rerun.log"
    if bash "$HARNESS_DIR/bin/sh-install.sh" --entrypoint install "$target" integrate >"$install_log" 2>&1; then
      preserved=true
      for i in "${!custom_files[@]}"; do
        after="$(shasum -a 256 "${custom_files[$i]}" | awk '{print $1}')"
        [[ "$after" == "${before[$i]}" ]] || preserved=false
      done
      if [[ "$preserved" == true ]]; then pass 'rerun preserves custom goal and both client routes byte-for-byte'; else fail 'rerun changed a custom goal or client route'; fi
      has_text "$(cat "$install_log")" 'CONFLICTS' 'rerun reports preserved route conflicts'
    else
      fail 'installer rerun failed on custom routes'
    fi
  else
    fail 'installer could not stage preservation fixture'
  fi
fi

python3 - "$HARNESS_DIR" "${2:-${TASK06_PYTHON_FIXTURE:-}}" "$packed_consumer" "$packed_consumer_ready" <<'PY'
from pathlib import Path
import hashlib
import re
import shutil
import subprocess
import sys
import tempfile

root = Path(sys.argv[1])
fixture_arg = sys.argv[2]
consumer_arg = sys.argv[3]
consumer_ready = sys.argv[4] == "1"

def require(condition, label):
    if condition:
        print(f"PASS: {label}")
    else:
        print(f"FAIL: {label}", file=sys.stderr)
        raise SystemExit(1)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def docs(base):
    source_tree = (base / "agents").is_dir()
    if source_tree:
        roles = base / "agents"
        commands = base / "commands"
        skills = base / "skills"
        sdd_command = commands / "sdd.md"
    else:
        roles = base / ".claude/agents"
        commands = base / ".claude/commands/spec-harness"
        skills = base / ".claude/skills"
        sdd_command = base / ".claude/commands/sdd.md"
    return {
        "planner": (roles / "sdd-planner.md").read_text(),
        "implementer": (roles / "sdd-implementer.md").read_text(),
        "reviewer": (roles / "sdd-reviewer.md").read_text(),
        "verifier": (roles / "sdd-verifier.md").read_text(),
        "researcher": (roles / "sdd-researcher.md").read_text(),
        "learner": (roles / "sdd-learner.md").read_text(),
        "sdd": sdd_command.read_text(),
        "plan": (commands / "plan.md").read_text(),
        "learn": (commands / "learn.md").read_text(),
        "learn_skill": (skills / "spec-harness-learn/SKILL.md").read_text(),
        "tester": (commands / "tester.md").read_text(),
        "tester_skill": (skills / "spec-harness-tester/SKILL.md").read_text(),
        "workflow_tester": (roles / "sdd-workflow-tester.md").read_text(),
        "workflows_readme": (base / ("templates/workflows/README.md" if source_tree else "workflows/README.md")).read_text(),
        "cli": (base / "bin/spec-harness").read_text() if source_tree else "",
        "generator": (base / "bin/sh-make-skills.sh").read_text() if source_tree else "",
    }

def role_contracts(d):
    planner, implementer, reviewer, researcher = (d[n] for n in ("planner", "implementer", "reviewer", "researcher"))
    required = {
        "planner accepted packet inputs": all(x in planner for x in ("spec.md` and its accepted `goal.md`", "Existing `specs/<feature>/plan.md`", "`specs/<feature>/tasks.md`", "Applicable `AGENTS.md`", "Relevant source, tests, manifests and inventory")),
        "planner produces plan then tasks": "Write or update `specs/<feature>/plan.md`" in planner and "Then write or update `specs/<feature>/tasks.md`" in planner,
        "planner optional design and research": "neither is a universal prerequisite" in planner and "when present or selected" in planner,
        "implementer reads assigned task, accepted spec goal plan, rules and source": all(x in implementer for x in ("assigned task", "`specs/<feature>/spec.md`, accepted `goal.md` and `plan.md`", "Applicable target rules", "Current source, tests, manifests, inventory and implementation receipt")),
        "implementer optional selected evidence": "when present or selected" in implementer,
        "reviewer reads feature goal, plan, task, diff, rules and gates": all(x in reviewer for x in ("`specs/<feature>/spec.md`, `goal.md` and `plan.md`", "assigned task's acceptance criteria", "Current diff and source revision", "Applicable `AGENTS.md`", "gate evidence")),
        "reviewer optional selected evidence": "when present or selected" in reviewer,
        "researcher works from spec goal rules source and inventory": all(x in researcher for x in ("`specs/<feature>/spec.md` and `goal.md`", "applicable `RULES.md`", "Relevant source, tests, manifests and inventory / context map")),
        "researcher optional design": "when present or selected" in researcher,
    }
    forbidden = ("Use AFTER spec.md and design.md exist", "design.md is mandatory", "research.md — your source of truth", "after researcher produced research.md")
    for name, text in (("planner", planner), ("implementer", implementer), ("reviewer", reviewer), ("researcher", researcher)):
        required[f"{name} has no mandatory design/research startup"] = not any(x in text for x in forbidden)
    return all(required.values()), required

def learning_contracts(d):
    learn, verifier, skill = d["learn"], d["verifier"], d["learn_skill"]
    order = [learn.find(x) for x in ("1. **Capture.**", "2. **Propose.**", "3. **Classify.**", "4. **Review.**", "5. **Apply only after approval.**", "6. **Report stale bindings.**")]
    return (
        all(i >= 0 for i in order) and order == sorted(order)
        and "PENDING: feedback captured; classification proposed" in learn
        and "`LEARNED` means reviewed and applied" in learn
        and "Inject safely." not in learn
        and "Append the proposed dated rule immediately" not in learn
        and ".memory/80-feedback.md" in verifier
        and "Do not append a cause to `AGENTS.md` automatically" in verifier
        and "record the existing human/reviewer decision" in skill
        and "Report LEARNED only after reviewed application" in skill
        and "classify by package path and concern, inject into its canonical owner" not in skill
        and "appended to AGENTS.md as a new hard constraint" not in verifier
    )

def tester_projection_contract(text):
    obsolete = (
        "Every BROKEN feeds the learn loop → dated rule + regression guard.",
        "dated rule into AGENTS.md + a recommended regression guard",
        "Every BROKEN automatically injects a dated rule and regression guard.",
    )
    return (
        "candidate guard" in text
        and "capture, classification and review" in text
        and "only after approval" in text
        and "PENDING/manual" in text
        and not any(x in text for x in obsolete)
    )

def tester_feedback_contract(d, source=False):
    carriers = (d["tester"], d["tester_skill"], d["workflow_tester"], d["workflows_readme"])
    content = "\n".join(carriers)
    tester_doc = " ".join(d["tester"].split())
    result = (
        "does not automatically change policy" in tester_doc
        and "Add a dated rule or regression test only when approved" in tester_doc
        and tester_projection_contract(d["tester_skill"])
        and "candidate guard for the learning loop" in d["workflow_tester"]
        and "only after approval" in d["workflow_tester"]
        and "does not establish future outcomes" in d["workflow_tester"]
        and "commands/learn.md" in d["workflows_readme"]
        and "review by the existing authority" in d["workflows_readme"]
        and "PENDING/manual" in d["workflows_readme"]
        and "dated rule into `AGENTS.md`" not in content
        and "Safe until the app changes" not in content
    )
    if source:
        result = result and (
            "PENDING/manual handoff" in d["cli"]
            and "apply policy only after approval" in d["cli"]
            and "policy changes require approval" in d["generator"]
            and "Apply a policy change only after approval" in d["generator"]
            and "Every BROKEN feeds the learn loop" not in d["generator"]
        )
    return result

MODEL_ID = re.compile(r"\b(?:gpt-\d[\w.-]*|opus|sonnet|haiku)\b")

def tier_contract(text, owns_table=False):
    """Roles ask for a tier. Model IDs live only in the one Model tiers table."""
    outside_table = "\n".join(line for line in text.splitlines() if not line.startswith("|"))
    result = (
        "Model tiers" in text and "nearest available tier" in text and "frontmatter" in text
        and not MODEL_ID.search(outside_table)
        and "Never silently" not in text and "silently switch/fall back" not in text
    )
    if owns_table:
        result = result and all(f"\n| {tier} |" in text for tier in ("strong", "fast", "review")) and all(
            x in text for x in ("Plan strong, implement fast", "Budget picks the review tier", "Independence never bends", "stays PENDING")
        )
    return result

LIGHT_ROUTE = (
    "### MICRO light route", "specs/<feature>/ticket.md", "not record file or diff hashes",
    "No separate tester, reviewer, planner", "is not the implementer's",
    "explicit authority before any commit, push or merge", "Escalate to LITE", "Evidence is proportional",
    "The implementer never edits `ticket.md`", "differ from the dispatched ones",
    "outside the expected ones", "copies that return unchanged", "as its gate set",
    "--untracked-files=all", "Only the orchestrator does",
)

def light_route_contract(d):
    """MICRO is one file and two stages, and still has an independent verifier."""
    return (
        all(token in d["sdd"] for token in LIGHT_ROUTE)
        and "you are the only gate" in d["verifier"]
        and "differ from the ones in your dispatch" in d["verifier"]
        and "never edit it" in d["implementer"]
    )

LEARNER_ROLE = (
    "Never edit application source", "Apply only what is approved", ".memory/60-decisions.md",
    "appears in two or more entries", "corrected project skill", "<!-- GEN:rules START -->",
)

def learner_contract(d):
    """A learning agent owns the loop, reaches skills and decisions, and never applies unreviewed."""
    return (
        all(token in d["learner"] for token in LEARNER_ROLE)
        and "dispatch `sdd-learner`" in d["sdd"] and "needs no\n  receipt row" in d["sdd"] and "only after the project's review authority approves" in d["sdd"]
        and "The `sdd-learner` role runs this procedure" in d["learn"] and "or correct the project skill" in d["learn"]
    )

TIER_ROLES = {
    "strong": ("planner", "merger"),
    "fast": ("implementer", "tester", "researcher", "documenter"),
    "review": ("verifier", "reviewer", "architect", "learner", "design-verifier", "workflow-tester"),
}

def role_models(base):
    return {p.stem[4:]: re.search(r"^model: (\S+)$", p.read_text(), re.M).group(1) for p in sorted((base / "agents").glob("sdd-*.md"))}

def frontmatter_matches_table(sdd, models):
    """Role frontmatter carries the Claude column of the tier table; review defaults to strong."""
    ids = {tier: MODEL_ID.findall(next(l for l in sdd.splitlines() if l.startswith(f"| {tier} |")).split("|")[3]) for tier in ("strong", "fast")}
    return (
        len(ids["strong"]) == 1 and bool(ids["fast"]) and ids["strong"][0] not in ids["fast"]
        and sorted(models) == sorted(r for roles in TIER_ROLES.values() for r in roles)
        and all(models[r] == ids["strong"][0] for r in TIER_ROLES["strong"] + TIER_ROLES["review"])
        and all(models[r] in ids["fast"] for r in TIER_ROLES["fast"])
    )

def no_model_ids_outside_table(texts):
    return not any(MODEL_ID.search(l) for t in texts for l in t.splitlines() if not l.startswith("|"))

TECH_WIRING = {
    "commands/init.md": "spec-harness-tech-<technology>", "commands/sdd.md": "a skill per major technology",
    "bin/sh-gen-agents.sh": "spec-harness-tech-<technology>/SKILL.md", "bin/sh-install.sh": "architecture performance packages tech",
    "templates/project-skills/spec-harness-tech.md": "## Derive",
    "README.md": "npx -y github:chohra-med/spec-harness-oss init . integrate",
    "docs/GETTING-STARTED.md": "3. Existing instruction files",
}

def wiring_contract(files):
    return all(token in files[path] for path, token in TECH_WIRING.items()) and "npx -y github:chohra-med/spec-harness-oss <subcommand>" in files["commands/sdd.md"]

d = docs(root)
ok, checks = role_contracts(d)
for label, result in checks.items():
    require(result, label)
require(all(x in d["sdd"] for x in ("specs/<feature>/input.md", "specs/<feature>/goal.md", "specs/<feature>/plan.md", "specs/<feature>/tasks.md")), "shared route aligns with ticket packet")
require(tier_contract(d["sdd"], owns_table=True), "shared route owns the single model-tier table and its rules")
require(tier_contract(d["plan"]), "plan route asks for tiers and names no model")
models = role_models(root)
require(frontmatter_matches_table(d["sdd"], models), "role frontmatter matches the Claude column of the tier table")
command_texts = {p.name: p.read_text() for p in sorted((root / "commands").glob("*.md"))}
require(no_model_ids_outside_table(command_texts.values()), "no command names a model outside the tier table")
wiring = {path: (root / path).read_text() for path in TECH_WIRING}
require(wiring_contract(wiring), "technology skills, quick start and CLI fallback are wired in every carrier")
require(light_route_contract(d), "MICRO light route is one file, two stages and an independent verifier")
require(learner_contract(d), "learning agent owns the loop and applies only reviewed changes")
require(learning_contracts(d), "feedback is captured and reviewed before policy application")
require(tester_feedback_contract(d, source=True), "source tester carriers agree on reviewed learning and PENDING/manual execution")
bad_tester = dict(d)
bad_tester["tester_skill"] += "\nEvery BROKEN automatically injects a dated rule and regression guard.\n"
require(not tester_feedback_contract(bad_tester, source=True), "RED control: planted obsolete generated automatic-injection claim")
consumer_root = Path(consumer_arg)
require(consumer_ready and consumer_root.is_dir(), "packed clean consumer exists for tester-coherence check")
if consumer_ready and consumer_root.is_dir():
    require(tester_feedback_contract(docs(consumer_root)), "packed installed tester carriers preserve reviewed learning boundary")

# Positive controls: each former contradiction must make its specific contract check fail.
bad_planner = dict(d); bad_planner["planner"] += "\nUse AFTER spec.md and design.md exist and AFTER the researcher's report.\n"
require(not role_contracts(bad_planner)[0], "RED control: planted mandatory design/research startup")
bad_verifier = dict(d); bad_verifier["verifier"] += "\nThe cause above should be appended to AGENTS.md as a new hard constraint.\n"
require(not learning_contracts(bad_verifier), "RED control: planted automatic verifier rule append")
bad_learn = dict(d); bad_learn["learn"] = bad_learn["learn"].replace("5. **Apply only after approval.**", "4. **Inject safely.** Append the proposed dated rule immediately.\n5. **Apply only after approval.**")
require(not learning_contracts(bad_learn), "RED control: planted unconditional learn injection")
bad_skill = dict(d); bad_skill["learn_skill"] = bad_skill["learn_skill"].replace("Apply a canonical rule only after approval", "classify by package path and concern, inject into its canonical owner")
require(not learning_contracts(bad_skill), "RED control: planted old generated unconditional injection")
for key in ("sdd", "plan"):
    owns = key == "sdd"
    bad_model = d[key] + "\nThis route requires the explicitly selected `gpt-6-sol` planner.\n"
    require(not tier_contract(bad_model, owns), f"RED control: planted hard-coded model outside the tier table in {key}")
    bad_stop = d[key] + "\nNever silently fall back; leave the stage PENDING.\n"
    require(not tier_contract(bad_stop, owns), f"RED control: planted stop-on-missing-model rule in {key}")
bad_independence = d["sdd"].replace("Independence never bends", "Independence is preferred")
require(not tier_contract(bad_independence, True), "RED control: removed independence rule from the tier table")
for token in LIGHT_ROUTE:
    bad_light = dict(d); bad_light["sdd"] = d["sdd"].replace(token, "[planted omission]")
    require(not light_route_contract(bad_light), f"RED control: light route without {token[:40]!r}")
for token in LEARNER_ROLE:
    bad_learner = dict(d); bad_learner["learner"] = d["learner"].replace(token, "[planted omission]")
    require(not learner_contract(bad_learner), f"RED control: learner role without {token[:32]!r}")
bad_dispatch = dict(d); bad_dispatch["sdd"] = d["sdd"].replace("dispatch `sdd-learner`", "[planted omission]")
require(not learner_contract(bad_dispatch), "RED control: shared route never dispatches the learner")
bad_gate = dict(d); bad_gate["verifier"] = d["verifier"].replace("you are the only gate", "[planted omission]")
require(not light_route_contract(bad_gate), "RED control: verifier role unaware it is the only MICRO gate")
for role, planted in (("planner", "sonnet"), ("verifier", "haiku"), ("merger", "sonnet"), ("implementer", "opus")):
    require(not frontmatter_matches_table(d["sdd"], dict(models, **{role: planted})), f"RED control: {role} frontmatter moved to {planted}")
require(not no_model_ids_outside_table(["Always dispatch the planner on gpt-6-sol and stop if it is missing."]), "RED control: planted unquoted model id in a command")
for path in TECH_WIRING:
    require(not wiring_contract(dict(wiring, **{path: "[planted omission]"})), f"RED control: wiring missing from {path}")
bad_micro = dict(d); bad_micro["implementer"] = d["implementer"].replace("never edit it", "[planted omission]")
require(not light_route_contract(bad_micro), "RED control: MICRO implementer allowed to edit its own goal")

# Re-run the skill generator in a disposable copy. Only the owned learn projection may differ;
# a second run must be byte-idempotent.
with tempfile.TemporaryDirectory(prefix="task06-skills-") as temporary:
    clone = Path(temporary) / "harness"
    clone.mkdir()
    shutil.copytree(root / "bin", clone / "bin")
    shutil.copytree(root / "skills", clone / "skills")
    def skill_hashes():
        return {str(p.relative_to(clone / "skills")): digest(p) for p in sorted((clone / "skills").rglob("SKILL.md"))}
    install_path = clone / "skills/spec-harness-install/SKILL.md"
    rules_path = clone / "skills/spec-harness-rules/SKILL.md"
    learn_path = clone / "skills/spec-harness-learn/SKILL.md"
    tester_path = clone / "skills/spec-harness-tester/SKILL.md"
    install_text = install_path.read_text().replace("follow `.claude/commands/spec-harness/init.md`", "follow ").replace("fallback: `commands/init.md`", "fallback: ")
    rules_text = rules_path.read_text().replace("Read `.claude/commands/spec-harness/rules.md`", "Read ").replace("fallback: `commands/rules.md`", "fallback: ")
    learn_text = learn_path.read_text().replace("Apply a canonical rule only after approval", "classify by package path and concern, inject into its canonical owner")
    tester_text = tester_path.read_text() + "\nEvery BROKEN automatically injects a dated rule and regression guard.\n"
    install_path.write_text(install_text)
    rules_path.write_text(rules_text)
    learn_path.write_text(learn_text)
    tester_path.write_text(tester_text)
    planted = skill_hashes()
    require("follow  as a capable model (source checkout fallback: )" in install_text, "RED control planted blank install paths")
    require("Read  (source checkout fallback: )" in rules_text, "RED control planted blank rules paths")
    require("inject into its canonical owner" in learn_text, "RED control planted unconditional learn summary")
    require(not tester_projection_contract(tester_text), "RED control: planted obsolete automatic-injection claim in tester projection")
    proc = subprocess.run(["bash", str(clone / "bin/sh-make-skills.sh")], cwd=clone, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    require(proc.returncode == 0 and not proc.stderr, f"actual generator succeeds without shell errors: {proc.stderr.strip()}")
    once = skill_hashes()
    changed = sorted(k for k in planted.keys() | once.keys() if planted.get(k) != once.get(k))
    require(changed == ["spec-harness-install/SKILL.md", "spec-harness-learn/SKILL.md", "spec-harness-rules/SKILL.md", "spec-harness-tester/SKILL.md"], f"only install/rules/learn/tester change on regeneration: {changed}")
    install_after = install_path.read_text()
    rules_after = rules_path.read_text()
    require(all(x in install_after.splitlines()[7] for x in (".claude/commands/spec-harness/init.md", "commands/init.md")), "generated install paragraph has both literal procedure paths")
    require(all(x in rules_after.splitlines()[7] for x in (".claude/commands/spec-harness/rules.md", "commands/rules.md")), "generated rules paragraph has both literal procedure paths")
    require("human/reviewer decision" in learn_path.read_text() and "only after approval" in learn_path.read_text(), "generated learn summary requires reviewed application")
    require(tester_projection_contract(tester_path.read_text()), "regenerated tester projection restores the reviewed-learning and manual-handoff boundary")
    proc = subprocess.run(["bash", str(clone / "bin/sh-make-skills.sh")], cwd=clone, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    require(proc.returncode == 0 and not proc.stderr, f"second generator run succeeds without shell errors: {proc.stderr.strip()}")
    require(once == skill_hashes(), "generated skills are byte-idempotent on the next run")

if fixture_arg:
    fixture = Path(fixture_arg)
    rule = (fixture / "RULES.md").read_text()
    memory = {
        "30-tech": (fixture / ".memory/30-tech.md").read_text(),
        "40-active": (fixture / ".memory/40-active.md").read_text(),
        "50-progress": (fixture / ".memory/50-progress.md").read_text(),
    }
    receipt = (fixture.parents[2] / "manual-ticket/IMPLEMENTATION.md").read_text()
    manifest = (fixture / "pyproject.toml").read_text()
    gates = [fixture / f"specs/normalize-names/gates/{name}.md" for name in ("tester", "verifier", "reviewer")]
    gate_texts = [path.read_text() for path in gates]
    import tomllib
    project = tomllib.loads(manifest).get("project", {})
    def state_ok(items):
        current_progress = items["50-progress"].partition("Implementation-stage observation, 2026-10-05, `normalize-names`:")[2].lower()
        return (
            "python3 -m unittest discover -s tests -p \"test_*.py\" -v" in rule
            and "**4 tests**" in receipt and "exited 0 (`OK`)" in receipt
            and "Tester, verifier, reviewer and merge gates all remain **PENDING**" in receipt
            and "scripts" not in project and "No test command" not in items["30-tech"]
            and all(
                re.search(
                    r"(?im)^\**(?:Status|Current status|Tester result|Current result):\s*\**(?:PENDING|PASS|FAIL|APPROVE|REJECT)\b",
                    text,
                )
                for text in gate_texts
            )
            and bool(current_progress) and "no feature implementation" not in current_progress
            and "4 tests GREEN at implementation" in items["50-progress"]
            and "gate records were PENDING" in items["50-progress"]
            and "specs/normalize-names/gates/{tester,verifier,reviewer}.md" in items["30-tech"]
        )
    require(state_ok(memory), "Python fixture current state matches RULES, packet and implementation receipt")
    stale_command = dict(memory)
    stale_command["30-tech"] += "\nNo test command in the fixture.\n"
    require(not state_ok(stale_command), "RED control: planted stale no-test-command claim")
    stale_implementation = dict(memory)
    stale_implementation["50-progress"] += "\nNo feature implementation.\n"
    require(not state_ok(stale_implementation), "RED control: planted stale no-feature-implementation claim")
else:
    print("SKIP: Python fixture state check; pass its root as argument 2 or TASK06_PYTHON_FIXTURE")

PY
contract_status=$?
if [[ "$contract_status" -ne 0 ]]; then fail "task06 semantic contract probes exit $contract_status"; fi

if [[ "$failures" -gt 0 ]]; then
  printf 'RED: %s of %s checks failed\n' "$failures" "$checks"
  exit 1
fi
printf 'GREEN: %s checks passed\n' "$checks"
