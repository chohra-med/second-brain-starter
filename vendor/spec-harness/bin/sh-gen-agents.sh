#!/usr/bin/env bash
# sh-gen-agents.sh — stage native source synthesis or check its receipt.
set -euo pipefail

SYS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

if [[ "${1:-}" == "--check" ]]; then
  [[ $# -eq 2 ]] || { echo "usage: sh-gen-agents.sh --check <target-dir>" >&2; exit 2; }
  command -v python3 >/dev/null 2>&1 || { echo "readiness check requires Python 3" >&2; exit 2; }
  python3 - "$2" <<'PY'
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

root = Path(sys.argv[1]).expanduser().resolve()
errors = []
def fail(message): errors.append(message)
def digest(data): return hashlib.sha256(data).hexdigest()
def safe_file(rel):
    path = root / rel
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or path.is_symlink() or root not in path.resolve().parents:
            return None
        return path.read_bytes()
    except (OSError, ValueError):
        return None

def safe_rel(value):
    return isinstance(value, str) and value and not value.startswith("/") and ".." not in Path(value).parts and "\\" not in value

if not root.is_dir():
    print(f"PENDING: target directory unavailable: {root}", file=sys.stderr)
    raise SystemExit(2)
receipt_path = ".claude/agents/.init-synthesis.json"
raw_receipt = safe_file(receipt_path)
if raw_receipt is None:
    print(f"PENDING: missing or unsafe synthesis receipt: {receipt_path}")
    raise SystemExit(1)
try:
    receipt = json.loads(raw_receipt)
except (UnicodeDecodeError, json.JSONDecodeError):
    print(f"PENDING: invalid JSON receipt: {receipt_path}")
    raise SystemExit(1)
if receipt.get("format") != "spec-harness-synthesis" or receipt.get("schema_version") != 1:
    fail("receipt format/schema_version must be spec-harness-synthesis/1")
if receipt.get("status") != "READY":
    fail(f"synthesis status is {receipt.get('status', 'missing')}; READY required")
if receipt.get("pending_reasons"):
    fail("receipt has pending_reasons: " + "; ".join(map(str, receipt.get("pending_reasons", []))))

inventory_rel = receipt.get("inventory_path")
if not safe_rel(inventory_rel):
    fail("receipt inventory_path is missing or unsafe")
    inventory_rel = ""
raw_inventory = safe_file(inventory_rel) if inventory_rel else None
if raw_inventory is None:
    fail(f"missing or unsafe inventory: {inventory_rel or '<unset>'}")
    inventory = {}
else:
    if digest(raw_inventory) != receipt.get("inventory_sha256"):
        fail("inventory hash changed; refresh affected synthesis outputs")
    if inventory_rel.endswith("project_inventory.json"):
        try:
            inventory = json.loads(raw_inventory)
            integrity = inventory.pop("integrity")
            canonical = json.dumps(inventory, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
            if inventory.get("format") != "spec-harness-project-inventory" or inventory.get("schema_version") != 1 or integrity.get("sha256") != digest(canonical):
                fail("project inventory schema or integrity check failed")
        except (UnicodeDecodeError, json.JSONDecodeError, KeyError, AttributeError, TypeError):
            inventory = {}
            fail("project inventory is malformed")
    elif inventory_rel.endswith("context_map.md"):
        text = raw_inventory.decode("utf-8", errors="replace")
        marker = re.search(rb"<!-- spec-harness-index:v1 sha256=([0-9a-f]{64}) -->\n$", raw_inventory)
        if not marker or digest(raw_inventory[:marker.start()]) != marker.group(1).decode("ascii"):
            fail("context map is custom or unverified; index it before declaring READY")
        packages = []
        sources_by_package = {}
        current = None
        for line in text.splitlines():
            match = re.match(r"### `([^`]+)`$", line)
            if match:
                current = match.group(1); packages.append(current); sources_by_package[current] = {}
                continue
            if current:
                source_match = re.search(r"Representative first-party source: (.+)$", line)
                if source_match:
                    for source in re.findall(r"`([^`]+)`", source_match.group(1)):
                        data = safe_file(source)
                        if data is not None:
                            sources_by_package[current][source] = digest(data)
        complete_match = re.search(r"Scan complete:\s*`?(true|false)`?", text)
        if "(unsupported)" in text or "(unreadable)" in text:
            fail("context map contains unsupported or unreadable manifest formats")
        inventory = {"packages": [{"path": p, "representative_sources": [{"path": path, "read_status": "read", "sha256": source_hash} for path, source_hash in sources_by_package[p].items()], "manifests": []} for p in packages], "scan": {"complete": bool(complete_match and complete_match.group(1) == "true")}}
        if not packages:
            fail("generated context map has no package boundaries")
    else:
        inventory = {}
        fail("inventory_path must name project_inventory.json or context_map.md")

if inventory and inventory.get("scan", {}).get("complete") is not True:
    fail("inventory is incomplete; partial scans cannot produce READY")
packages = inventory.get("packages", [])
package_paths = [row.get("path") for row in packages if isinstance(row, dict) and isinstance(row.get("path"), str)]
if not package_paths:
    fail("inventory contains no package paths")
if receipt.get("package_paths") != package_paths:
    fail("receipt package_paths do not match the current inventory")
source_hashes = {}
for package in packages:
    package_path = package.get("path")
    for manifest in package.get("manifests", []):
        if manifest.get("status") in {"unsupported", "unreadable"}:
            fail(f"unsupported or unreadable manifest remains at package {package_path}: {manifest.get('path', manifest.get('format', 'unknown'))}")
    for source in package.get("representative_sources", []):
        if source.get("read_status") == "read" and source.get("path") and source.get("sha256"):
            source_hashes[(package_path, source["path"])] = source["sha256"]
if not source_hashes:
    fail("inventory has no readable representative source files")

def has_unresolved_scaffold(data):
    # Policy tokens map to templates/RULES.md (DIR) and templates/AGENTS.md
    # (PROJECT_NAME, PROTECTED_PATHS, STOP_CONDITIONS, MAX_RETRIES, STACK_RULES);
    # CLAUDE.md and constitution.md also use PROJECT_NAME. Keep JSX identifiers literal.
    return re.search(rb"(?i:\bPENDING\b|generated at init)|_\s*<[^>\r\n]+>_\s*|\{\{(?:DIR|PROJECT_NAME|PROTECTED_PATHS|STOP_CONDITIONS|MAX_RETRIES|STACK_RULES)\}\}", data)

# The installed scaffold's frequent-rules stub is an explicit blocker.
frequent = safe_file("ai_rules/rules/frequent_rules.md")
if frequent is not None and has_unresolved_scaffold(frequent):
    fail("ai_rules/rules/frequent_rules.md still contains a stub or placeholder")

def validate_citations(owner, citations, allowed_packages):
    if not isinstance(citations, list) or not citations:
        fail(f"{owner}: missing representative-source citations")
        return
    seen_packages = set()
    for citation in citations:
        if not isinstance(citation, dict):
            fail(f"{owner}: malformed citation row")
            continue
        package_path = citation.get("package_path")
        path = citation.get("path")
        start, end = citation.get("line_start"), citation.get("line_end")
        if package_path not in allowed_packages or not safe_rel(path):
            fail(f"{owner}: citation has unknown package or unsafe path: {package_path} / {path}")
            continue
        expected = source_hashes.get((package_path, path))
        if expected is None:
            fail(f"{owner}: citation is not a representative source for package {package_path}: {path}")
            continue
        data = safe_file(path)
        if data is None or digest(data) != citation.get("sha256") or citation.get("sha256") != expected:
            fail(f"{owner}: source citation hash is fake or stale: {path}")
            continue
        lines = data.decode("utf-8", errors="replace").splitlines()
        if not isinstance(start, int) or not isinstance(end, int) or start < 1 or end < start or end > len(lines):
            fail(f"{owner}: invalid citation line span {path}:{start}-{end}")
            continue
        seen_packages.add(package_path)
    if set(allowed_packages) - seen_packages:
        fail(f"{owner}: missing representative-source citations for package(s): {', '.join(sorted(set(allowed_packages) - seen_packages))}")

package_rows = receipt.get("packages")
if not isinstance(package_rows, list) or [row.get("path") for row in package_rows if isinstance(row, dict)] != package_paths:
    fail("package rule outputs do not cover the inventory package paths in order")
else:
    for row in package_rows:
        package_path = row["path"]
        rules_path = row.get("rules_path")
        expected_rules_path = "RULES.md" if package_path == "." else package_path + "/RULES.md"
        if row.get("status") != "READY" or rules_path != expected_rules_path or not safe_rel(rules_path):
            fail(f"package {package_path}: rules output is missing, unsafe or not READY")
            continue
        raw_rules = safe_file(rules_path)
        if raw_rules is None or digest(raw_rules) != row.get("sha256"):
            fail(f"package {package_path}: rules output is missing or stale: {rules_path}")
            continue
        if has_unresolved_scaffold(raw_rules):
            fail(f"package {package_path}: rules file is a stub or has placeholders: {rules_path}")
        if not re.search(rb"(?im)^##\s+Coding\b", raw_rules) or not re.search(rb"(?im)^##\s+Architecture\b", raw_rules) or not re.search(rb"(?im)^##\s+Packages\b", raw_rules) or not re.search(rb"(?im)^##\s+Testing\b", raw_rules) or not re.search(rb"(?im)^##\s+Reviewing\b", raw_rules):
            fail(f"package {package_path}: RULES.md must contain Coding, Architecture, Packages, Testing and Reviewing sections")
        validate_citations(f"package {package_path}", row.get("citations"), [package_path])
        for citation in row.get("citations", []):
            if isinstance(citation, dict) and f"{citation.get('path')}:{citation.get('line_start')}" not in raw_rules.decode("utf-8", errors="replace"):
                fail(f"package {package_path}: citation line is absent from rules output: {citation.get('path')}:{citation.get('line_start')}")

required_skills = {"spec-harness-architecture", "spec-harness-performance", "spec-harness-packages"}
skill_rows = receipt.get("skills", [])
skill_names = [row.get("name") for row in skill_rows if isinstance(row, dict) and isinstance(row.get("name"), str)] if isinstance(skill_rows, list) else []
# Technology skills are optional and scoped to the packages that use that technology.
tech_skills = [name for name in skill_names if name not in required_skills]
if not isinstance(skill_rows, list) or len(skill_names) != len(skill_rows) or len(set(skill_names)) != len(skill_names) or not required_skills.issubset(skill_names):
    fail("receipt must contain the architecture, performance and packages project skills, once each")
elif len(tech_skills) > 5 or not all(re.fullmatch(r"spec-harness-tech-[a-z0-9]+(?:-[a-z0-9]+)*", name) for name in tech_skills):
    fail("extra project skills must be named spec-harness-tech-<technology>, at most five")
else:
    for row in skill_rows:
        name = row["name"]
        path = row.get("path")
        packages_for_skill = row.get("package_paths")
        expected_skill_path = f".claude/skills/{name}/SKILL.md"
        scoped = isinstance(packages_for_skill, list) and (
            packages_for_skill == package_paths if name in required_skills
            else bool(packages_for_skill) and set(packages_for_skill) <= set(package_paths)
        )
        if row.get("status") != "READY" or path != expected_skill_path or not safe_rel(path) or not scoped:
            fail(f"skill {name}: status/path/package applicability is incomplete")
            continue
        data = safe_file(path)
        if data is None or digest(data) != row.get("sha256"):
            fail(f"skill {name}: output is missing or stale: {path}")
            continue
        text = data.decode("utf-8", errors="replace")
        if "<!-- source-bound: inventory-sha256=" + str(receipt.get("inventory_sha256")) + " -->" not in text:
            fail(f"skill {name}: source binding is stale or missing")
        # Skills quote real code and prose: only the upper-case status word marks an unfinished copy.
        if re.search(rb"\bPENDING\b", data):
            fail(f"skill {name}: generic scaffold or placeholder remains")
        for package_path in packages_for_skill:
            if package_path not in text:
                fail(f"skill {name}: missing package applicability {package_path}")
        validate_citations(f"skill {name}", row.get("citations"), packages_for_skill)
        for citation in row.get("citations", []):
            if isinstance(citation, dict) and f"{citation.get('path')}:{citation.get('line_start')}" not in text:
                fail(f"skill {name}: citation line is absent from skill output: {citation.get('path')}:{citation.get('line_start')}")

required_roles = {"sdd-planner", "sdd-implementer", "sdd-tester", "sdd-verifier", "sdd-reviewer"}
role_rows = receipt.get("roles", [])
roles = {row.get("name"): row for row in role_rows if isinstance(row, dict)} if isinstance(role_rows, list) else {}
if not required_roles.issubset(roles):
    fail("required role bindings missing: " + ", ".join(sorted(required_roles - set(roles))))
for name, row in roles.items():
    path = row.get("path")
    packages_for_role = row.get("package_paths")
    expected_role_path = f".claude/agents/{name}.md"
    if row.get("status") != "BOUND" or path != expected_role_path or not safe_rel(path) or packages_for_role != package_paths:
        fail(f"role {name}: binding is missing, unsafe or not scoped to every package")
        continue
    data = safe_file(path)
    if data is None or digest(data) != row.get("sha256"):
        fail(f"role {name}: role file changed after the receipt; binding is stale: {path}")
        continue
    text = data.decode("utf-8", errors="replace")
    if "No project-specific rules generated yet" in text:
        fail(f"role {name}: generic rules stub remains")
    starts = list(re.finditer(r"<!-- GEN:rules START -->", text))
    ends = list(re.finditer(r"<!-- GEN:rules END -->", text))
    if len(starts) != 1 or len(ends) != 1 or starts[0].end() > ends[0].start():
        fail(f"role {name}: GEN:rules markers are missing or ambiguous")
        continue
    block = text[starts[0].end():ends[0].start()]
    if f"inventory-sha256={receipt.get('inventory_sha256')}" not in block:
        fail(f"role {name}: stale inventory binding in GEN:rules block")
    for package_path in package_paths:
        if package_path not in block:
            fail(f"role {name}: GEN:rules block omits package {package_path}")
    if name in {"sdd-tester", "sdd-verifier", "sdd-reviewer"} and not re.search(r"(?i)(fresh|clean) context", block):
        fail(f"role {name}: separate fresh-context requirement is missing")
    validate_citations(f"role {name}", row.get("citations"), package_paths)
    if name not in required_roles and not row.get("selection_reason"):
        fail(f"optional role {name}: missing selection reason")
    for citation in row.get("citations", []):
        if isinstance(citation, dict) and citation.get("path") and f"{citation['path']}:{citation.get('line_start')}" not in block:
            fail(f"role {name}: cited source line is absent from its generated block: {citation['path']}:{citation.get('line_start')}")

for row in receipt.get("excluded_roles", []):
    if not isinstance(row, dict) or not row.get("name") or not row.get("reason"):
        fail("each excluded optional role needs a name and evidence-based reason")
if "sdd-merger" in roles:
    merger = roles["sdd-merger"]
    if not merger.get("selection_reason") or not merger.get("authority_citation"):
        fail("sdd-merger is selected without a cited explicit merge authority")

if errors:
    print("PENDING: synthesis readiness check failed")
    for error in errors:
        print(f"- {error}")
    raise SystemExit(1)
package_label = "package" if len(package_paths) == 1 else "packages"
print(f"READY: {len(package_paths)} {package_label}, {len(skill_rows)} skills, {len(roles)} selected roles; inventory and cited hashes match")
PY
  exit $?
fi

[[ $# -eq 1 ]] || { echo "usage: sh-gen-agents.sh <target-dir> | --check <target-dir>" >&2; exit 2; }
TARGET="$1"
[[ -d "$TARGET" ]] || { echo "target is not a directory: $TARGET" >&2; exit 2; }
ABS="$(cd "$TARGET" && pwd -P)"
for path in "$TARGET/.claude" "$TARGET/.claude/agents"; do
  [[ ! -L "$path" ]] || { echo "refusing to write through directory symlink: $path" >&2; exit 2; }
done
mkdir -p "$TARGET/.claude/agents"
AGENTS_DIR="$TARGET/.claude/agents"
PROMPT="$AGENTS_DIR/.generate-agents.prompt.md"
if [[ -e "$PROMPT" ]] && ! grep -q '^<!-- spec-harness-work-order:v1 -->$' "$PROMPT"; then
  echo "PENDING: existing work order is not Spec Harness-owned; preserving $PROMPT" >&2
  exit 2
fi
if [[ -f "$TARGET/ai_rules/project_inventory.json" ]]; then
  INVENTORY="ai_rules/project_inventory.json"
  INVENTORY_STATUS="structured inventory present; verify schema and integrity"
elif [[ -f "$TARGET/ai_rules/context_map.md" ]] && grep -q 'spec-harness-index:v1' "$TARGET/ai_rules/context_map.md"; then
  INVENTORY="ai_rules/context_map.md"
  INVENTORY_STATUS="generated map present; use only its enumerated paths and open each actual source"
else
  INVENTORY=""
  INVENTORY_STATUS="validated inventory missing or custom map has no companion JSON"
fi
TEMP_PROMPT="$(mktemp "$AGENTS_DIR/.generate-agents.XXXXXX")"
trap 'rm -f "$TEMP_PROMPT"' EXIT
cat > "$TEMP_PROMPT" <<'EOF_PROMPT'
<!-- spec-harness-work-order:v1 -->
# Work order — source-grounded synthesis for @PROJECT_NAME@

**Status: PENDING.** This shell command stages instructions only. It has not derived rules, written project skills, bound a role, checked a citation or dispatched a model.

- Target root: `@TARGET_ROOT@`
- Inventory path: `@INVENTORY_PATH@` (@INVENTORY_STATUS@)
- Read `.claude/commands/spec-harness/{init,rules,generate-agents}.md` and `.claude/spec-harness/methods/spec-harness-{architecture,performance,packages,tech}.md`. In a source checkout only, fall back to `commands/` and `templates/project-skills/` respectively. Inventory with the installed `spec-harness index <target>` entrypoint (source checkout fallback: `bin/sh-index.sh <target>`).

## Execute in this order

0. For an already initialized target, before reindexing snapshot the exact old receipt, inventory, every selected package rule, all project skills and each selected role file. Confirm prior synthesis and separate semantic-review evidence, source-bound markers, receipt paths/citations/output hashes, and the authorized generated region for each output. A matching receipt hash alone never authorizes replacement. If preimage, ownership or no-intervening-edit evidence is missing, preserve that output byte-for-byte and record `CONFLICT/PENDING`. Keep populated human `RULES.md` without a clearly authorized generated region untouched.
1. Read the target's `AGENTS.md`, `RULES.md`, `CONTRIBUTING.md`, `ai_rules/globalRules.md`, `ai_rules/rules/frequent_rules.md`, `ai_rules/context_map.md` or `ai_rules/project_inventory.json`, `.memory/`, `.cursor/rules/`, `.Codex/`, `README.md` and every startup path those instructions name. Follow startup instructions. Read the selected inventory and inspect project structure; enumerate package boundaries, manifests, lockfiles, installed skills, exclusions and unsupported formats before deriving any project guidance.
2. Open the actual representative source files, imports/resolution evidence and relevant tests/config for every package. Cite exact line spans and SHA-256. Confirm declared dependency ranges separately from resolved/installed versions. Do not make package-use, architecture, SOLID or performance claims from inventory labels or names alone. Surface policy/source conflicts; do not silently replace existing policy.
3. After steps 1-2, apply relevant reusable methods from the installed `ponytail.md`, `grill-me.md`, `package-finder.md` and `skill-finder.md` owners (source checkout fallback: `commands/`). Open only relevant skill candidates, check exposed capabilities, and record selected/excluded evidence in the existing owned outputs. Match package documentation identity/version to target runtime/native/peer constraints; unavailable coverage, provenance or tooling stays PENDING. Do not install packages or third-party skills.
4. Fill only empty rule sections or explicit PENDING scaffolds. Produce one package-scoped `RULES.md` output record for every inventory package, with all five standard sections and citations. Do not copy rules across package boundaries.
5. Maintain the three core skills `.claude/skills/spec-harness-architecture/SKILL.md`, `.claude/skills/spec-harness-performance/SKILL.md` and `.claude/skills/spec-harness-packages/SKILL.md`, plus one `.claude/skills/spec-harness-tech-<technology>/SKILL.md` per major technology the source actually uses (at most five, per the `tech` method). On first initialization, create each only when absent. On guarded refresh, reuse or refresh an existing skill only when its captured preimage and prior receipt, source-bound marker, documented generated ownership and no-custom-edit evidence all agree. If ownership is unproven or the file is custom/mismatched, preserve its bytes and record `CONFLICT/PENDING`. Use the corresponding installed method file. Each generated skill includes `<!-- source-bound: inventory-sha256=<raw inventory file hash> -->`.
6. Bind the required roles `sdd-planner`, `sdd-implementer`, `sdd-tester`, `sdd-verifier` and `sdd-reviewer` inside their existing `GEN:rules` regions. After reindex, enumerate every selected role GEN block and each skill marker whose raw inventory hash changed, even when only one package's source changed. Refresh all such verified generated marker consumers and their receipt hashes. The project-aware planner binding is required for ticket planning. Require separate fresh contexts for tester, verifier and reviewer. Preserve each canonical role file outside its GEN block byte-for-byte, including its duties, safeguards, procedures and output format. Add package-specific rules inside the block; do not replace role behavior with generic evidence notes. Bind merger only with an explicit cited authority and current need. Select research, design or workflow roles only from observed project/task evidence. Cite package-specific source lines, record exclusions and preserve bytes outside owned markers.
7. Write `.claude/agents/.init-synthesis.json` using schema 1 described in `.claude/commands/spec-harness/generate-agents.md` (source checkout fallback: `commands/generate-agents.md`). It must use the exact package paths from the inventory, include output hashes and citation path/line/hash records, and remain `PENDING` for missing, conflicting, unsupported or stale evidence.
8. Follow guarded refresh owned by `.claude/commands/sdd.md`. Before any reindex, use step 0's snapshots; a receipt hash is not write authority. Preserve populated human rules without an authorized generated region, custom/mismatched skills and unproven outputs byte-for-byte as `CONFLICT/PENDING`. After re-grounding affected claims, enumerate and refresh every stale raw-inventory marker consumer across all project skills and selected role GEN blocks, then run `bash <spec-harness>/bin/sh-gen-agents.sh --check <target>`. A failed check names the missing, stale, conflicting or unsupported evidence. A passing result confirms recorded structure and current cited bytes; it does not establish that the claim follows from its citation. In a separate fresh reviewer context, inspect each generated rule, skill and role claim against its cited source span; check package scope, policy conflicts, and whether any recommendation is mislabeled as observed behavior. Record that review and its outcome. If a source cannot be read or does not independently support the claim, or no independent review context is available, leave overall initialization PENDING.
A passing --check proves structural integrity and current cited bytes only. Before declaring overall initialization READY, a separate fresh reviewer must check that each cited span supports its rule, skill and role claim, package boundaries are respected, and conflicts or unsupported recommendations are surfaced. Record that independent review; if no such context is available, keep overall initialization PENDING even when --check prints READY. Feature goals, test results, human approval and release remain separate. Do not claim a role was dispatched unless the current native client confirms that capability and run.
EOF_PROMPT
python3 - "$TEMP_PROMPT" "$(basename "$ABS")" "$ABS" "${INVENTORY:-missing}" "$INVENTORY_STATUS" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text()
for token, value in zip(("@PROJECT_NAME@", "@TARGET_ROOT@", "@INVENTORY_PATH@", "@INVENTORY_STATUS@"), sys.argv[2:]):
    text = text.replace(token, value)
path.write_text(text)
PY
mv "$TEMP_PROMPT" "$PROMPT"
trap - EXIT
printf 'PENDING: staged native synthesis work order → %s\n' "$PROMPT"
printf 'Inventory: %s (%s)\n' "${INVENTORY:-missing}" "$INVENTORY_STATUS"
printf 'Next: capable model reads target evidence, writes owned outputs, then runs --check.\n'
