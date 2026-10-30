#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
# shellcheck source=lib/portable.sh
. "$ROOT/tests/lib/portable.sh"
require_tools git
require_python311
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-synthesis-contract.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

for file in bin/sh-gen-agents.sh bin/sh-make-skills.sh; do
  bash -n "$ROOT/$file"
done
echo "PASS: generator shell syntax"

python3 -I -B - "$ROOT" "$TMP" <<'PY'
import ast
import copy
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1])
tmp = Path(sys.argv[2])
index = root / "bin/sh-index.sh"
bind = root / "bin/sh-gen-agents.sh"
owned_skills = {
    "spec-harness", "spec-harness-install", "spec-harness-tickets",
    "spec-harness-spec", "spec-harness-plan", "spec-harness-tasks",
    "spec-harness-build", "spec-harness-verify", "spec-harness-tester",
    "spec-harness-learn", "spec-harness-rules",
    "spec-harness-generate-agents", "spec-harness-audit",
}

def run(args, expected, label):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode != expected:
        raise AssertionError(f"{label}: expected exit {expected}, got {result.returncode}\n{result.stdout}")
    return result.stdout

def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

try:
    run(["python3", "-I", "-B", "-c", "pass"], 1, "expected-failure helper positive control")
except AssertionError as error:
    assert "expected exit 1, got 0" in str(error), error
    print("PASS: expected-failure helper rejects a successful child")
else:
    raise AssertionError("expected-failure helper accepted a successful child")

# Regeneration must preserve every unowned skill byte, including untracked files
# and extra files beneath generator-owned directories.
copy_root = tmp / "harness-copy"
copy_root.mkdir()
shutil.copytree(root / "bin", copy_root / "bin")
shutil.copytree(root / "skills", copy_root / "skills")
shutil.copytree(root / "templates", copy_root / "templates")
write(copy_root / "skills/custom-untracked/SKILL.md", "custom skill bytes\n")
write(copy_root / "skills/spec-harness-build/KEEP.txt", "extra user file\n")

def unowned_hashes():
    values = {}
    for path in sorted((copy_root / "skills").rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(copy_root / "skills")
        if relative.parts[0] in owned_skills and relative == Path(relative.parts[0]) / "SKILL.md":
            continue
        values[str(relative)] = sha(path)
    return values

before = unowned_hashes()
out = run(["bash", str(copy_root / "bin/sh-make-skills.sh")], 0, "safe skill regeneration")
after = unowned_hashes()
assert before == after, (before.keys() ^ after.keys(), before, after)
assert (copy_root / "skills/spec-harness-build/KEEP.txt").read_text() == "extra user file\n"
assert "actual representative source" in (copy_root / "skills/spec-harness-install/SKILL.md").read_text()
assert "--check" in (copy_root / "skills/spec-harness-generate-agents/SKILL.md").read_text()
assert "affected skill/role bindings as stale" in (copy_root / "skills/spec-harness-learn/SKILL.md").read_text()
generated_agents = (copy_root / "skills/spec-harness-generate-agents/SKILL.md").read_text()
assert "project-aware planner" in generated_agents
assert "separate fresh reviewer" in generated_agents
assert all((copy_root / "templates/project-skills" / f"{name}.md").is_file() for name in (
    "spec-harness-architecture", "spec-harness-performance", "spec-harness-packages"))
print(f"PASS: regeneration preserved {len(before)} unowned skill files; {out.splitlines()[-1]}")

# Build clean Expo, Python and mixed fixtures, plus an unsupported manifest case.
fixtures = {}
for name in ("expo", "python", "mixed", "unsupported"):
    fixtures[name] = tmp / name
    fixtures[name].mkdir()

expo = fixtures["expo"]
write(expo / "package.json", '{"name":"expo-fixture","scripts":{"test":"jest"},"dependencies":{"expo":"~53.0.0","react-native":"*"}}\n')
write(expo / "src/App.tsx", "export function App() {\n  return null;\n}\n")
write(expo / "tests/App.test.tsx", "test('app', () => { expect(true).toBe(true); });\n")

python = fixtures["python"]
write(python / "pyproject.toml", "[project]\nname = 'python-fixture'\ndependencies = ['fastapi>=0.1']\n[project.scripts]\nserve = 'main:run'\n")
write(python / "src/main.py", "def run():\n    return 'ok'\n")
write(python / "tests/test_main.py", "def test_run():\n    assert True\n")

mixed = fixtures["mixed"]
write(mixed / "package.json", '{"name":"mixed-fixture","private":true,"workspaces":["apps/*","services/*"]}\n')
write(mixed / "src/root.ts", "export const root = true;\n")
write(mixed / "apps/mobile/package.json", '{"name":"mobile-fixture","scripts":{"test":"jest"},"dependencies":{"expo":"~53.0.0"}}\n')
write(mixed / "apps/mobile/src/App.tsx", "export function App() {\n  return null;\n}\n")
write(mixed / "services/api/pyproject.toml", "[project]\nname = 'api-fixture'\ndependencies = ['fastapi>=0.1']\n")
write(mixed / "services/api/src/main.py", "def run():\n    return 'api'\n")
write(mixed / "AGENTS.md", "# Fixture policy\nKeep changes small.\nRun the package tests.\n")
write(mixed / ".cursor/rules/pending.md", "# Rules\nPENDING: write the project rules here.\n")
write(mixed / "apps/mobile/AGENTS.md", "# Mobile policy\nKeep screens plain.\nNo network in tests.\n")
write(mixed / "ai_rules/context_map.md", "# Malik-owned map\nPreserve this file byte-for-byte.\n")
custom_map_hash = sha(mixed / "ai_rules/context_map.md")
write(mixed / "ai_rules/rules/frequent_rules.md", "# Frequent rules\nPENDING: derive from project source.\n")

unsupported = fixtures["unsupported"]
write(unsupported / "Cargo.toml", "[package]\nname = 'rust-fixture'\nversion = '0.1.0'\n")
write(unsupported / "src/lib.rs", "pub fn value() -> bool { true }\n")

for name, path in fixtures.items():
    run(["bash", str(index), str(path)], 0, f"index {name}")

assert "unsupported" in (unsupported / "ai_rules/context_map.md").read_text()
assert sha(mixed / "ai_rules/context_map.md") == custom_map_hash
inventory_path = mixed / "ai_rules/project_inventory.json"
inventory = json.loads(inventory_path.read_text())
package_paths = [row["path"] for row in inventory["packages"]]
assert package_paths == [".", "apps/mobile", "services/api"], package_paths
assert all(row["representative_sources"] for row in inventory["packages"]), inventory["packages"]
print(f"PASS: inventory exposes mixed package paths {package_paths} and preserves the custom map")
print("PASS: unsupported manifest remains visible in the generated inventory")

# The shell only stages a PENDING work order and does not overwrite a custom skill.
conflict_target = tmp / "conflict"
shutil.copytree(expo, conflict_target)
write(conflict_target / ".claude/skills/spec-harness-performance/SKILL.md", "user customization\n")
conflict_hash = sha(conflict_target / ".claude/skills/spec-harness-performance/SKILL.md")
run(["bash", str(bind), str(conflict_target)], 0, "stage conflict work order")
prompt = (conflict_target / ".claude/agents/.generate-agents.prompt.md").read_text()
assert "Status: PENDING" in prompt
assert "CONFLICT/PENDING" in prompt
assert ".claude/commands/spec-harness/{init,rules,generate-agents}.md" in prompt
assert "templates/project-skills/" in prompt
assert "A matching receipt hash alone never authorizes replacement." in prompt
# The refresh and CONFLICT/PENDING rules are owned by commands/init.md (tests/rule-ownership-contract.sh); the work order only points there.
assert "follow `commands/init.md` step 5, which owns those rules" in prompt
assert sha(conflict_target / ".claude/skills/spec-harness-performance/SKILL.md") == conflict_hash
assert str(conflict_target) not in prompt and str(tmp) not in prompt, "work order embeds an absolute target path"
assert "Target root: the project directory that contains this `.claude/` directory" in prompt
missing = run(["bash", str(bind), "--check", str(conflict_target)], 1, "missing receipt RED control")
assert "PENDING: missing or unsafe synthesis receipt" in missing
print("PASS: shell staging preserves literal Markdown paths, stays PENDING and leaves a conflicting skill unchanged")
print("RED control observed: readiness rejects the missing synthesis receipt")

# Build a structurally valid receipt with real inventory source paths and current hashes.
inventory_hash = sha(inventory_path)
citations = {}
for package in inventory["packages"]:
    source = next(row for row in package["representative_sources"] if row.get("read_status") == "read")
    path = source["path"]
    file = mixed / path
    lines = file.read_text().splitlines()
    citations[package["path"]] = {
        "package_path": package["path"],
        "path": path,
        "line_start": 1,
        "line_end": min(2, len(lines)),
        "sha256": sha(file),
    }

write(mixed / "ai_rules/rules/frequent_rules.md", "# Frequent rules\n- Read package rules before changes.\n")

packages_rows = []
for package_path in package_paths:
    citation = citations[package_path]
    rules_path = "RULES.md" if package_path == "." else package_path + "/RULES.md"
    cited = f"{citation['path']}:{citation['line_start']}-{citation['line_end']}"
    content = (
        f"# Rules for {package_path}\n\n"
        "## Coding\n- [OBSERVED] Follow this package's opened source pattern. Evidence: " + cited + "\n\n"
        "## Architecture\n- [OBSERVED] Keep changes within this package boundary. Evidence: " + cited + "\n\n"
        "## Packages\n- [OBSERVED] Use only declared package dependencies. Evidence: " + cited + "\n\n"
        "## Testing\n- [OBSERVED] Preserve the package's current test shape. Evidence: " + cited + "\n\n"
        "## Reviewing\n- [OBSERVED] Review this package against the cited source. Evidence: " + cited + "\n"
    )
    file = mixed / rules_path
    write(file, content)
    packages_rows.append({
        "path": package_path, "status": "READY", "rules_path": rules_path,
        "sha256": sha(file), "citations": [citation],
    })

skills = []
for name in ("spec-harness-architecture", "spec-harness-performance", "spec-harness-packages"):
    path = f".claude/skills/{name}/SKILL.md"
    lines = [f"# {name}", "", "Package applicability: " + ", ".join(package_paths), ""]
    lines.append(f"<!-- source-bound: inventory-sha256={inventory_hash} -->")
    for citation in citations.values():
        lines.append(f"Evidence: {citation['path']}:{citation['line_start']}-{citation['line_end']}")
    file = mixed / path
    write(file, "\n".join(lines) + "\n")
    skills.append({
        "name": name, "status": "READY", "path": path, "sha256": sha(file),
        "package_paths": package_paths, "citations": list(citations.values()),
    })

roles = []
for name in ("sdd-planner", "sdd-implementer", "sdd-tester", "sdd-verifier", "sdd-reviewer"):
    path = f".claude/agents/{name}.md"
    rows = ["<!-- GEN:rules START -->"]
    for package_path, citation in citations.items():
        rows.append(f"Package: {package_path}")
        rows.append(f"[OBSERVED] Follow package evidence {citation['path']}:{citation['line_start']}-{citation['line_end']}.")
        if name in ("sdd-tester", "sdd-verifier", "sdd-reviewer"):
            rows.append("Run in a fresh context.")
    rows.append(f"<!-- bound: 2026-10-05 inventory-sha256={inventory_hash} -->")
    rows.append("<!-- GEN:rules END -->")
    file = mixed / path
    write(file, "\n".join(rows) + "\n")
    roles.append({
        "name": name, "status": "BOUND", "path": path, "sha256": sha(file),
        "package_paths": package_paths,
        "citations": list(citations.values()),
        "selection_reason": "Required role for project SDD acceptance.",
    })

receipt = {
    "format": "spec-harness-synthesis",
    "schema_version": 1,
    "status": "READY",
    "inventory_path": "ai_rules/project_inventory.json",
    "inventory_sha256": inventory_hash,
    "package_paths": package_paths,
    "packages": packages_rows,
    "skills": skills,
    "roles": roles,
    "excluded_roles": [{"name": "sdd-design-verifier", "reason": "No UI task or visual surface is declared by this fixture."}],
    "pending_reasons": [],
}
receipt_path = mixed / ".claude/agents/.init-synthesis.json"
write(receipt_path, json.dumps(receipt, indent=2) + "\n")
green = run(["bash", str(bind), "--check", str(mixed)], 0, "valid synthesis GREEN control")
assert "READY: 3 packages, 3 skills, 5 selected roles" in green
print(green.strip())

# Technology skills are optional, named spec-harness-tech-<technology>, capped at five and scoped
# to the packages that use the technology.
tech_package = package_paths[0]
tech_citation = citations[tech_package]
tech_path = ".claude/skills/spec-harness-tech-react-native/SKILL.md"
write(mixed / tech_path, "\n".join([
    "# spec-harness-tech-react-native", "", f"Package applicability: {tech_package}", "",
    f"<!-- source-bound: inventory-sha256={inventory_hash} -->",
    f"Evidence: {tech_citation['path']}:{tech_citation['line_start']}-{tech_citation['line_end']}",
]) + "\n")
tech_row = {
    "name": "spec-harness-tech-react-native", "status": "READY", "path": tech_path,
    "sha256": sha(mixed / tech_path), "package_paths": [tech_package], "citations": [tech_citation],
}
def check_skills(rows, expected, label):
    write(receipt_path, json.dumps(dict(receipt, skills=rows), indent=2) + "\n")
    return run(["bash", str(bind), "--check", str(mixed)], expected, label)
assert "READY: 3 packages, 4 skills, 5 selected roles" in check_skills(skills + [tech_row], 0, "scoped technology skill GREEN control")
assert "spec-harness-tech-<technology>" in check_skills(skills + [dict(tech_row, name="random-skill")], 1, "RED control: unnamed extra skill")
assert "at most five" in check_skills(skills + [dict(tech_row, name=f"spec-harness-tech-t{i}") for i in range(6)], 1, "RED control: six technology skills")
assert "package applicability is incomplete" in check_skills(skills + [dict(tech_row, package_paths=["not-a-package"])], 1, "RED control: technology skill on an unknown package")
# A technology skill chooses its own packages, so it still shows evidence from each one (RFC 0009 keeps this).
assert "missing source citations for package(s): services/api" in check_skills(
    skills + [dict(tech_row, package_paths=[tech_package, "services/api"])], 1, "RED control: technology skill scoped to a package it cites nothing from")
assert "package applicability is incomplete" in check_skills(skills + [dict(tech_row, package_paths=[])], 1, "RED control: unscoped technology skill")
assert "once each" in check_skills(skills[:2] + [tech_row], 1, "RED control: technology skill replacing a core skill")
five = []
for i in range(5):
    p = f".claude/skills/spec-harness-tech-t{i}/SKILL.md"
    write(mixed / p, (mixed / tech_path).read_text() + "\nExample: `<View style={{flex: 1}} />` and the `FETCH_PENDING` action. Show a spinner while the request is pending.\n")
    five.append(dict(tech_row, name=f"spec-harness-tech-t{i}", path=p, sha256=sha(mixed / p)))
assert "READY: 3 packages, 8 skills" in check_skills(skills + five, 0, "five technology skills with JSX and *_PENDING text GREEN control")
assert "once each" in check_skills(skills + [dict(tech_row, name=["x"])], 1, "RED control: non-string skill name fails closed without a traceback")
for row in five:
    (mixed / row["path"]).unlink(); (mixed / row["path"]).parent.rmdir()
(mixed / tech_path).unlink(); (mixed / tech_path).parent.rmdir()
assert "READY: 3 packages, 3 skills, 5 selected roles" in check_skills(skills, 0, "core-only receipt restored GREEN")
print("PASS: technology skill accepted when named, capped and scoped; five planted failures rejected")

# Core-skill schema: schema 1 keeps the original three core skills; schema 2 (first initialisation)
# requires five. Each fixture is a disposable copy of the mixed target with its own receipt.
PURPOSE_CORE_1 = ["spec-harness-architecture", "spec-harness-performance", "spec-harness-packages"]
PURPOSE_CORE_2 = PURPOSE_CORE_1 + ["spec-harness-quality", "spec-harness-conduct"]

def core_skill_row(target, name):
    path = f".claude/skills/{name}/SKILL.md"
    lines = [f"# {name}", "", "Package applicability: " + ", ".join(package_paths), ""]
    lines.append(f"<!-- source-bound: inventory-sha256={inventory_hash} -->")
    for citation in citations.values():
        lines.append(f"Evidence: {citation['path']}:{citation['line_start']}-{citation['line_end']}")
    write(target / path, "\n".join(lines) + "\n")
    return {
        "name": name, "status": "READY", "path": path, "sha256": sha(target / path),
        "package_paths": package_paths, "citations": list(citations.values()),
    }

def purpose_check(label, schema_version, names, expected):
    target = tmp / label
    shutil.copytree(mixed, target)
    rows = [core_skill_row(target, name) for name in names]
    write(target / ".claude/agents/.init-synthesis.json",
          json.dumps(dict(receipt, schema_version=schema_version, skills=rows), indent=2) + "\n")
    return run(["bash", str(bind), "--check", str(target)], expected, label)

schema_one = purpose_check("purpose-schema-1-three", 1, PURPOSE_CORE_1, 0)
assert "READY: 3 packages, 3 skills, 5 selected roles" in schema_one, schema_one
schema_two = purpose_check("purpose-schema-2-five", 2, PURPOSE_CORE_2, 0)
assert "READY: 3 packages, 5 skills, 5 selected roles" in schema_two, schema_two
no_quality = purpose_check(
    "purpose-schema-2-no-quality", 2, [n for n in PURPOSE_CORE_2 if n != "spec-harness-quality"], 1
)
assert "missing: spec-harness-quality" in no_quality, no_quality
no_conduct = purpose_check(
    "purpose-schema-2-no-conduct", 2, [n for n in PURPOSE_CORE_2 if n != "spec-harness-conduct"], 1
)
assert "missing: spec-harness-conduct" in no_conduct, no_conduct
three_under_two = purpose_check("purpose-schema-2-three", 2, PURPOSE_CORE_1, 1)
assert "missing: spec-harness-conduct, spec-harness-quality" in three_under_two, three_under_two
# Schema 3 (policy coverage) is accepted; its own fixtures are below. Schema 4 (rule layers) is
# covered by tests/rule-layers-fixtures.sh. 5 is the next unknown version.
for label, bad in (("bool-true", True), ("float-2.0", 2.0), ("string-2", "2"), ("integer-5", 5)):
    rejected = purpose_check(f"purpose-schema-bad-{label}", bad, PURPOSE_CORE_2, 1)
    assert "schema_version must be" in rejected, (label, rejected)
print("PASS: schema 1 accepts three core skills; schema 2 accepts five and names a missing quality or conduct skill")
print("PASS: schema_version true, 2.0, \"2\" and 5 are rejected; only integer 1, 2, 3 or 4 is accepted")

# Human-authored policy can contain code examples whose syntax resembles a
# template marker. JSX object props and TypeScript generics belong in a valid
# synthesis fixture without being mistaken for unresolved placeholders.
human_examples = tmp / "human-rule-examples"
shutil.copytree(mixed, human_examples)
human_receipt_path = human_examples / ".claude/agents/.init-synthesis.json"
human_receipt = json.loads(human_receipt_path.read_text())
frequent_path = human_examples / "ai_rules/rules/frequent_rules.md"
write(frequent_path, """# Frequent rules

Inline styles are forbidden. Example: `<View style={{ marginTop: 16 }}>...</View>`.
Avoid `any` types. Example: `const ref = useRef<any>(null);`.
JSX shorthand: `<Component data={{value}} />`.
JSX uppercase prop: `<Component data={{MY_VALUE}} />`.
Before a push, update every pending PR description. Pending reviews block merge.
""")
root_rules_path = human_examples / "RULES.md"
with root_rules_path.open("a") as file:
    file.write("\n## Preserved human examples\n\n")
    file.write("JSX: `<View style={{ marginTop: 16 }}>...</View>`.\n")
    file.write("JSX shorthand: `<Component data={{value}} />`.\n")
    file.write("JSX uppercase prop: `<Component data={{MY_VALUE}} />`.\n")
    file.write("TypeScript generic: `useRef<any>(null)`.\n")
    file.write("Prose: list each pending migration in the PR.\n")
root_rules_row = next(row for row in human_receipt["packages"] if row["path"] == ".")
root_rules_row["sha256"] = sha(root_rules_path)
write(human_receipt_path, json.dumps(human_receipt, indent=2) + "\n")
human_green = run(["bash", str(bind), "--check", str(human_examples)], 0, "human JSX/generic examples GREEN control")
assert "READY: 3 packages, 3 skills, 5 selected roles" in human_green
print("PASS: readiness accepts human JSX and generic examples")
print("PASS: readiness accepts lower-case and title-case \"pending\" in human prose")

def placeholder_red(label, path, text, diagnostic):
    preimage = path.read_bytes()
    try:
        path.write_bytes(preimage + text.encode())
        if path == root_rules_path:
            root_rules_row["sha256"] = sha(path)
            write(human_receipt_path, json.dumps(human_receipt, indent=2) + "\n")
        output = run(["bash", str(bind), "--check", str(human_examples)], 1, label)
        assert diagnostic in output, (label, output)
        print("RED control observed: " + diagnostic)
    finally:
        path.write_bytes(preimage)
        if path == root_rules_path:
            root_rules_row["sha256"] = sha(path)
            write(human_receipt_path, json.dumps(human_receipt, indent=2) + "\n")

placeholder_red(
    "PENDING marker RED control", frequent_path,
    "\nPENDING: derive from project source.\n",
    "ai_rules/rules/frequent_rules.md still contains a stub or placeholder",
)
placeholder_red(
    "generated-at-init marker RED control", frequent_path,
    "\nRules generated at init.\n",
    "ai_rules/rules/frequent_rules.md still contains a stub or placeholder",
)
placeholder_red(
    "template variable RED control", frequent_path,
    "\nProject: {{PROJECT_NAME}}\n",
    "ai_rules/rules/frequent_rules.md still contains a stub or placeholder",
)
for scaffold_token in ("DIR", "PROTECTED_PATHS", "STOP_CONDITIONS", "MAX_RETRIES", "STACK_RULES"):
    placeholder_red(
        f"{scaffold_token} policy template token RED control", frequent_path,
        f"\nTemplate token: {{{{{scaffold_token}}}}}\n",
        "ai_rules/rules/frequent_rules.md still contains a stub or placeholder",
    )
placeholder_red(
    "known scaffold placeholder RED control", root_rules_path,
    "\n_<add a delta here only if a subtree pins differently>_\n",
    "package .: rules file is a stub or has placeholders: RULES.md",
)
assert "READY:" in run(["bash", str(bind), "--check", str(human_examples)], 0, "restored human-rule GREEN control")

# Exercise the generated-Markdown fallback from sh-index, including its backticked scan status.
markdown_target = tmp / "markdown-ready"
shutil.copytree(mixed, markdown_target)
(markdown_target / "ai_rules/context_map.md").unlink()
# A dependency literally named "(unsupported)" is data, not a manifest status; it must not block READY.
write(markdown_target / "package.json", '{"name":"mixed-fixture","private":true,"workspaces":["apps/*","services/*"],"dependencies":{"(unsupported)":"*"}}\n')
run(["bash", str(index), str(markdown_target)], 0, "generate context map for fallback GREEN control")
markdown_map = markdown_target / "ai_rules/context_map.md"
assert "`(unsupported)`" in markdown_map.read_text(), "the hostile dependency name must reach the map for this control to mean anything"
markdown_hash = sha(markdown_map)
markdown_receipt = copy.deepcopy(receipt)
markdown_receipt["inventory_path"] = "ai_rules/context_map.md"
markdown_receipt["inventory_sha256"] = markdown_hash
markdown_bytes = markdown_map.read_bytes()
marker = re.search(rb"<!-- spec-harness-index:v1 sha256=([0-9a-f]{64}) -->\n$", markdown_bytes)
assert marker and hashlib.sha256(markdown_bytes[:marker.start()]).hexdigest().encode() == marker.group(1), repr(markdown_bytes[-100:])
assert re.search(r"Scan complete:\s*`?true`?", markdown_bytes.decode())
for row in markdown_receipt["skills"]:
    file = markdown_target / row["path"]
    text = file.read_text().replace(receipt["inventory_sha256"], markdown_hash)
    file.write_text(text)
    row["sha256"] = sha(file)
for row in markdown_receipt["roles"]:
    file = markdown_target / row["path"]
    text = file.read_text().replace(receipt["inventory_sha256"], markdown_hash)
    file.write_text(text)
    row["sha256"] = sha(file)
write(markdown_target / ".claude/agents/.init-synthesis.json", json.dumps(markdown_receipt, indent=2) + "\n")
markdown_green = run(["bash", str(bind), "--check", str(markdown_target)], 0, "generated Markdown inventory GREEN control")
assert "READY: 3 packages, 3 skills, 5 selected roles" in markdown_green
print("PASS: generated Markdown fallback accepts the index's backticked complete-scan status")

# RED control: a real unsupported manifest in a generated Markdown map still refuses READY, even when every
# other binding is re-grounded on the new map.
unsupported_target = tmp / "markdown-unsupported"
shutil.copytree(markdown_target, unsupported_target)
write(unsupported_target / "apps/mobile/Cargo.toml", "[package]\nname = \"mobile-native\"\n")
run(["bash", str(index), str(unsupported_target)], 0, "regenerate context map with an unsupported manifest")
unsupported_map = unsupported_target / "ai_rules/context_map.md"
assert re.search(r"^- Manifests: .*`apps/mobile/Cargo.toml` \(unsupported\)", unsupported_map.read_text(), re.M)
unsupported_hash = sha(unsupported_map)
unsupported_receipt = copy.deepcopy(markdown_receipt)
unsupported_receipt["inventory_sha256"] = unsupported_hash
for row in unsupported_receipt["skills"] + unsupported_receipt["roles"]:
    file = unsupported_target / row["path"]
    file.write_text(file.read_text().replace(markdown_hash, unsupported_hash))
    row["sha256"] = sha(file)
write(unsupported_target / ".claude/agents/.init-synthesis.json", json.dumps(unsupported_receipt, indent=2) + "\n")
unsupported_red = run(["bash", str(bind), "--check", str(unsupported_target)], 1, "unsupported manifest in a Markdown map RED control")
assert "context map contains unsupported or unreadable manifest formats" in unsupported_red, unsupported_red
print("RED control observed: a real unsupported manifest in a generated Markdown map refuses READY")

# RED control: ticket initialization cannot pass without the project-aware planner binding.
without_planner = copy.deepcopy(receipt)
without_planner["roles"] = [row for row in without_planner["roles"] if row["name"] != "sdd-planner"]
write(receipt_path, json.dumps(without_planner, indent=2) + "\n")
planner_missing = run(["bash", str(bind), "--check", str(mixed)], 1, "missing planner binding RED control")
assert "required role bindings missing: sdd-planner" in planner_missing
print("RED control observed: readiness requires a project-aware planner binding")
write(receipt_path, json.dumps(receipt, indent=2) + "\n")

# RED control: a fabricated source path cannot be made valid by updating its receipt.
bad = copy.deepcopy(receipt)
bad["packages"][0]["citations"][0]["path"] = "src/fabricated.ts"
write(receipt_path, json.dumps(bad, indent=2) + "\n")
fake_citation = run(["bash", str(bind), "--check", str(mixed)], 1, "fake citation RED control")
assert "citation is not a representative source" in fake_citation
print("RED control observed: " + next(line.strip() for line in fake_citation.splitlines() if "citation is not a representative source" in line))

# RED control: changing a bound role after receipt creation makes it stale.
write(receipt_path, json.dumps(receipt, indent=2) + "\n")
reviewer_path = mixed / ".claude/agents/sdd-reviewer.md"
reviewer_preimage = reviewer_path.read_bytes()
reviewer_path.write_bytes(reviewer_preimage + b"\n<!-- stale role mutation -->\n")
stale = run(["bash", str(bind), "--check", str(mixed)], 1, "stale binding RED control")
assert "role file changed after the receipt; binding is stale" in stale
print("RED control observed: " + next(line.strip() for line in stale.splitlines() if "role file changed after the receipt" in line))
reviewer_path.write_bytes(reviewer_preimage)
assert "READY:" in run(["bash", str(bind), "--check", str(mixed)], 0, "restored synthesis GREEN control")

# RED control: an unfilled shared rules scaffold cannot pass.
frequent_path = mixed / "ai_rules/rules/frequent_rules.md"
frequent_preimage = frequent_path.read_bytes()
frequent_path.write_text("# Frequent rules\nPENDING: still a stub.\n")
stub = run(["bash", str(bind), "--check", str(mixed)], 1, "frequent rules stub RED control")
assert "frequent_rules.md still contains a stub or placeholder" in stub
print("RED control observed: " + next(line.strip() for line in stub.splitlines() if "frequent_rules.md still" in line))
frequent_path.write_bytes(frequent_preimage)
assert "READY:" in run(["bash", str(bind), "--check", str(mixed)], 0, "final synthesis GREEN control")

# Policy citations (RFC 0007 point 7): an inventoried, read, hash-matching, applicable rule file may be cited
# beside the package's representative-source citation. Anything else stays refused.
policy_rows = {row["path"]: row for row in inventory["rule_files"]}
assert policy_rows["AGENTS.md"]["read_status"] == "read" and "AGENTS.md" in inventory["packages"][0]["applicable_instructions"]
def policy_citation(package_path, path, **override):
    row = {"package_path": package_path, "path": path, "line_start": 1, "line_end": 2, "sha256": sha(mixed / path)}
    row.update(override)
    return row
def policy_receipt(package_index, cites, drop_source=False):
    value = copy.deepcopy(receipt)
    row = value["packages"][package_index]
    row["citations"] = (cites if drop_source else row["citations"] + cites)
    return value
def policy_check(value, expected, label):
    # The cited line must appear in the package's rules output, so append it there for this run only.
    rules = {}
    for row in value["packages"]:
        rules[row["rules_path"]] = (mixed / row["rules_path"]).read_bytes()
        extra = "".join(f"- [OBSERVED] Keep to the cited policy. Evidence: {c['path']}:{c['line_start']}-{c['line_end']}\n" for c in row["citations"] if c["path"].endswith("AGENTS.md") or c["path"] == "NOTES.md")
        if extra:
            (mixed / row["rules_path"]).write_bytes(rules[row["rules_path"]] + extra.encode())
            row["sha256"] = sha(mixed / row["rules_path"])
    try:
        write(receipt_path, json.dumps(value, indent=2) + "\n")
        return run(["bash", str(bind), "--check", str(mixed)], expected, label)
    finally:
        for rel, data in rules.items():
            (mixed / rel).write_bytes(data)

ok = policy_check(policy_receipt(0, [policy_citation(".", "AGENTS.md")]), 0, "policy citation GREEN control")
assert "READY:" in ok
print("PASS: an inventoried, hash-matching AGENTS.md citation beside the source citation is READY")
stale = policy_check(policy_receipt(0, [policy_citation(".", "AGENTS.md", sha256="0" * 64)]), 1, "stale policy hash RED control")
assert "policy file citation hash is fake or stale: AGENTS.md" in stale and "source citation hash" not in stale
print("RED control observed: a stale policy citation hash is refused")
write(mixed / "NOTES.md", "Loose notes\nNot an inventory rule file\n")
unlisted = policy_check(policy_receipt(0, [policy_citation(".", "NOTES.md")]), 1, "uninventoried policy RED control")
assert "not a representative source or an applicable policy file" in unlisted
print("RED control observed: a file that is not an inventory rule file is refused")
(mixed / "NOTES.md").unlink()
elsewhere = policy_check(policy_receipt(2, [policy_citation("services/api", "apps/mobile/AGENTS.md")]), 1, "inapplicable policy RED control")
assert "not a representative source or an applicable policy file" in elsewhere
print("RED control observed: a rule file that does not apply to the package is refused")
harness_file = policy_check(policy_receipt(0, [policy_citation(".", "ai_rules/rules/frequent_rules.md", sha256=policy_rows["ai_rules/rules/frequent_rules.md"]["sha256"])]), 1, "harness template as policy RED control")
assert "not a representative source or an applicable policy file" in harness_file
print("RED control observed: an installed harness file (frequent_rules.md) is not citable project policy")
pending_file = policy_check(policy_receipt(0, [policy_citation(".", ".cursor/rules/pending.md")]), 1, "pending scaffold as policy RED control")
assert "not a representative source or an applicable policy file" in pending_file
print("RED control observed: a PENDING scaffold file is not citable project policy")
only_policy = policy_check(policy_receipt(0, [policy_citation(".", "AGENTS.md")], drop_source=True), 1, "policy-only RED control")
assert "missing representative-source citations for package(s): ." in only_policy
print("RED control observed: policy citations cannot replace the representative-source citation")
dotdot = policy_check(policy_receipt(0, [policy_citation(".", "apps/../AGENTS.md")]), 1, "dot-dot policy path RED control")
assert "unknown package or unsafe path" in dotdot
print("RED control observed: a policy path containing .. is refused")
write(receipt_path, json.dumps(receipt, indent=2) + "\n")
assert "READY:" in run(["bash", str(bind), "--check", str(mixed)], 0, "policy controls restored GREEN control")
# In-package source citations: a first-party source file that the citing package owns may be cited
# beside its representative source. Package rows still need a representative source.
inpkg_base = tmp / "in-package-base"
shutil.copytree(mixed, inpkg_base, symlinks=True)
write(inpkg_base / "src/extra.ts", "export const extra = 1;\nexport const more = 2;\n")
write(inpkg_base / "apps/mobile/src/helper.ts", "export const helper = 1;\nexport const more = 2;\n")
write(inpkg_base / "services/api/src/helper.py", "def helper():\n    return 1\n")
write(inpkg_base / "apps/mobile/.config/x.ts", "export const config = 1;\nexport const more = 2;\n")
write(inpkg_base / "apps/mobile/node_modules/dep/index.ts", "export const dep = 1;\nexport const more = 2;\n")
write(inpkg_base / "services/api/NOTES.md", "Loose notes\nNot a source file\n")
write(inpkg_base / "services/api/composer.json", '{"name": "acme/api",\n "scripts": {"test": "phpunit"}}\n')

def inpkg_citation(package_path, path, **override):
    row = {"package_path": package_path, "path": path, "line_start": 1, "line_end": 2}
    # Hash the file only when the caller gave no hash: a case-variant path names no file on a case-sensitive file system.
    row["sha256"] = override.pop("sha256") if "sha256" in override else sha(inpkg_base / path)
    row.update(override)
    return row

def cite_in_file(target, row, cites):
    # The generator requires each citation's path:line to appear in the skill or role text itself.
    file = target / row["path"]
    evidence = "".join(f"Evidence: {c['path']}:{c['line_start']}-{c['line_end']}\n" for c in cites)
    text = file.read_text()
    if "<!-- GEN:rules END -->" in text:
        text = text.replace("<!-- GEN:rules END -->", evidence + "<!-- GEN:rules END -->")
    else:
        text += evidence
    file.write_text(text)
    row["sha256"] = sha(file)
    row["citations"] = row["citations"] + cites

def add_skill_citation(cite):
    def mutate(target, value):
        skill = next(row for row in value["skills"] if row["name"] == "spec-harness-architecture")
        cite_in_file(target, skill, [cite])
    return mutate

def inpkg_check(label, mutate, expected, needle):
    target = tmp / label
    shutil.copytree(inpkg_base, target, symlinks=True)
    value = copy.deepcopy(receipt)
    mutate(target, value)
    write(target / ".claude/agents/.init-synthesis.json", json.dumps(value, indent=2) + "\n")
    output = run(["bash", str(bind), "--check", str(target)], expected, label)
    assert needle in output, (label, output)
    return output

def green_role_and_skill(target, value):
    cite = inpkg_citation("apps/mobile", "apps/mobile/src/helper.ts")
    skill = next(row for row in value["skills"] if row["name"] == "spec-harness-architecture")
    cite_in_file(target, skill, [cite])
    role = next(row for row in value["roles"] if row["name"] == "sdd-reviewer")
    cite_in_file(target, role, [cite])

def green_skill_only_in_package(target, value):
    skill = next(row for row in value["skills"] if row["name"] == "spec-harness-architecture")
    skill["citations"] = []
    cite_in_file(target, skill, [
        inpkg_citation(".", "src/extra.ts"),
        inpkg_citation("apps/mobile", "apps/mobile/src/helper.ts"),
        inpkg_citation("services/api", "services/api/src/helper.py"),
    ])

def red_package_row_only_in_package(target, value):
    row = next(row for row in value["packages"] if row["path"] == "apps/mobile")
    row["citations"] = [inpkg_citation("apps/mobile", "apps/mobile/src/helper.ts")]

def red_symlink_in_package(target, value):
    (target / "apps/mobile/src/link.ts").symlink_to("helper.ts")
    cite = {"package_path": "apps/mobile", "path": "apps/mobile/src/link.ts", "line_start": 1, "line_end": 2,
            "sha256": sha(inpkg_base / "apps/mobile/src/helper.ts")}
    add_skill_citation(cite)(target, value)

inpkg_check("in-package-role-and-skill-GREEN", green_role_and_skill, 0, "READY: 3 packages, 3 skills, 5 selected roles")
print("PASS: a role and a skill may cite a non-representative in-package source file")
inpkg_check("in-package-skill-only-GREEN", green_skill_only_in_package, 0, "READY: 3 packages, 3 skills, 5 selected roles")
print("PASS: a skill may cite only in-package source files when every package has one")
inpkg_check("in-package-composer-GREEN", add_skill_citation(inpkg_citation("services/api", "services/api/composer.json")), 0, "READY: 3 packages, 3 skills, 5 selected roles")
print("PASS: a skill may cite an in-package composer.json")
inpkg_check("in-package-package-row-RED", red_package_row_only_in_package, 1,
            "missing representative-source citations for package(s): apps/mobile")
print("RED control observed: a package row cannot be backed by an in-package source file alone")
inpkg_check("in-package-nested-owner-RED", add_skill_citation(inpkg_citation(".", "apps/mobile/src/helper.ts")), 1,
            "and not an in-package source file for package . (nested package): apps/mobile/src/helper.ts")
print("RED control observed: a file owned by a nested package is refused under the parent package")
inpkg_check("in-package-dot-dir-RED", add_skill_citation(inpkg_citation("apps/mobile", "apps/mobile/.config/x.ts")), 1,
            "and not an in-package source file for package apps/mobile (hidden): apps/mobile/.config/x.ts")
print("RED control observed: a source file under a dot directory is refused")
inpkg_check("in-package-node-modules-RED", add_skill_citation(inpkg_citation("apps/mobile", "apps/mobile/node_modules/dep/index.ts")), 1,
            "and not an in-package source file for package apps/mobile (ignored): apps/mobile/node_modules/dep/index.ts")
print("RED control observed: a source file under node_modules is refused")
inpkg_check("in-package-non-source-RED", add_skill_citation(inpkg_citation("services/api", "services/api/NOTES.md")), 1,
            "and not an in-package source file for package services/api (not a source type): services/api/NOTES.md")
print("RED control observed: a non-source file inside the package is refused")
inpkg_check("in-package-stale-RED", add_skill_citation(inpkg_citation("apps/mobile", "apps/mobile/src/helper.ts", sha256="0" * 64)), 1,
            "source citation hash is fake or stale: apps/mobile/src/helper.ts")
print("RED control observed: an in-package source with a stale hash is refused")
inpkg_check("in-package-symlink-RED", red_symlink_in_package, 1,
            "and not an in-package source file for package apps/mobile (not a regular in-root file): apps/mobile/src/link.ts")
print("RED control observed: a symlinked in-package source is refused, with its reason")

# Correction round 1. Names are compared casefolded, the indexer's file classes apply to single files,
# and every refusal says why. Each control below is new in round 1 unless it says otherwise.
for rel, text in {
    "services/api/data/x.py": "def x():\n    return 1\n",
    "apps/mobile/secrets/x.ts": "export const secret = 1;\nexport const more = 2;\n",
    "apps/mobile/src/api.generated.ts": "export const generated = 1;\nexport const more = 2;\n",
    "apps/mobile/src/vendor.min.js": "var v = 1;\nvar w = 2;\n",
    "apps/mobile/src/token": "token = 1\nmore = 2\n",
    "apps/mobile2/src/x.ts": "export const x = 1;\nexport const more = 2;\n",
}.items():
    write(inpkg_base / rel, text)

def refused_in_package(label, package_path, path, reason, sha_path=None):
    # sha_path names the real file when the spelling in path differs from it (a case-insensitive file system).
    cite = inpkg_citation(package_path, path, sha256=sha(inpkg_base / (sha_path or path)))
    inpkg_check(label, add_skill_citation(cite), 1,
                f"and not an in-package source file for package {package_path} ({reason}): {path}")
    print(f"RED control observed: {label} refused ({reason})")

refused_in_package("in-package-case-nested-RED", ".", "Apps/Mobile/src/helper.ts", "nested package", "apps/mobile/src/helper.ts")
refused_in_package("in-package-case-ignored-RED", "apps/mobile", "apps/mobile/Node_Modules/dep/index.ts", "ignored",
                   "apps/mobile/node_modules/dep/index.ts")
refused_in_package("in-package-private-dir-RED", "apps/mobile", "apps/mobile/secrets/x.ts", "private")
refused_in_package("in-package-data-dir-RED", "services/api", "services/api/data/x.py", "data")
refused_in_package("in-package-generated-name-RED", "apps/mobile", "apps/mobile/src/api.generated.ts", "generated source file")
refused_in_package("in-package-generated-min-RED", "apps/mobile", "apps/mobile/src/vendor.min.js", "generated source file")
refused_in_package("in-package-credential-name-RED", "apps/mobile", "apps/mobile/src/token", "credential or signing asset")
refused_in_package("in-package-sibling-owner-RED", "services/api", "apps/mobile/src/helper.ts", "outside package")
refused_in_package("in-package-shared-prefix-RED", "apps/mobile", "apps/mobile2/src/x.ts", "outside package")

def partial_skill_coverage(target, value):
    skill = next(row for row in value["skills"] if row["name"] == "spec-harness-architecture")
    skill["citations"] = []
    cite_in_file(target, skill, [inpkg_citation(".", "src/extra.ts"), inpkg_citation("apps/mobile", "apps/mobile/src/helper.ts")])

def policy_only_skill(target, value):
    # The only citation is a policy file: policy adds provenance and never counts as source evidence.
    skill = next(row for row in value["skills"] if row["name"] == "spec-harness-architecture")
    skill["citations"] = []
    cite_in_file(target, skill, [inpkg_citation(".", "AGENTS.md")])

# RFC 0009: a skill or role cites what it claims; it need not cite a file in every package it applies to.
inpkg_check("in-package-partial-skill-coverage-GREEN", partial_skill_coverage, 0, "READY: 3 packages, 3 skills, 5 selected roles")
print("PASS: a skill that cites source for only some of its packages is accepted (citation per claim)")
def partial_role_coverage(target, value):
    role = next(row for row in value["roles"] if row["name"] == "sdd-reviewer")
    role["citations"] = []
    cite_in_file(target, role, [inpkg_citation("apps/mobile", "apps/mobile/src/helper.ts")])

def policy_only_role(target, value):
    role = next(row for row in value["roles"] if row["name"] == "sdd-reviewer")
    role["citations"] = []
    cite_in_file(target, role, [inpkg_citation(".", "AGENTS.md")])

inpkg_check("in-package-partial-role-coverage-GREEN", partial_role_coverage, 0, "READY: 3 packages, 3 skills, 5 selected roles")
print("PASS: a role that cites source for only some of its packages is accepted (citation per claim)")
role_policy_out = inpkg_check("in-package-policy-only-role-RED", policy_only_role, 1, "missing source citations")
assert "a policy file never counts as source evidence" in role_policy_out, role_policy_out
print("RED control observed: a role whose only citation is a policy file is refused")
policy_only_out = inpkg_check("in-package-policy-only-skill-RED", policy_only_skill, 1, "missing source citations")
assert "a policy file never counts as source evidence" in policy_only_out, policy_only_out
print("RED control observed: a skill whose only citation is a policy file is refused")

# Correction round 2. Each new refusal below is seen red before its guard exists.
def either_reason(label, package_path, path, reasons, sha_path):
    # Used where the spelling decides which of two refusals fires (case and form depend on the disk).
    cite = inpkg_citation(package_path, path, sha256=sha(inpkg_base / sha_path))
    out = inpkg_check(label, add_skill_citation(cite), 1,
                      f"and not an in-package source file for package {package_path} (")
    assert any(f"({reason}): {path}" in out for reason in reasons), out
    print(f"RED control observed: {label} refused ({' or '.join(reasons)}): {path}")

def rebound_exclusion(label, disk_path, exclude_dir, row_path):
    # Index the disk spelling with an explicit exclusion, then rewrite the one inventory row to row_path,
    # so the exclusion row and the file name differ only in case or form. The receipt is rebound to the new hash.
    target = tmp / label
    shutil.copytree(inpkg_base, target, symlinks=True)
    write(target / disk_path, "def gen():\n    return 2\n")
    run(["bash", str(index), str(target), "--exclude-dir", exclude_dir], 0, label + " index")
    inventory_file = target / "ai_rules/project_inventory.json"
    text = inventory_file.read_text()
    assert exclude_dir in text, (label, exclude_dir)
    inventory_file.write_text(text.replace(exclude_dir, row_path))
    new_hash = sha(inventory_file)
    value = copy.deepcopy(receipt)
    value["inventory_sha256"] = new_hash
    for row in value["skills"] + value["roles"]:
        file = target / row["path"]
        file.write_text(file.read_text().replace(inventory_hash, new_hash))
        row["sha256"] = sha(file)
    return target, value

def exclusion_refused(label, disk_path, exclude_dir, row_path, cite_path, sha_path):
    target, value = rebound_exclusion(label, disk_path, exclude_dir, row_path)
    cite = {"package_path": "services/api", "path": cite_path, "line_start": 1, "line_end": 2, "sha256": sha(target / sha_path)}
    add_skill_citation(cite)(target, value)
    write(target / ".claude/agents/.init-synthesis.json", json.dumps(value, indent=2) + "\n")
    out = run(["bash", str(bind), "--check", str(target)], 1, label)
    assert f"and not an in-package source file for package services/api (excluded): {cite_path}" in out, out
    print(f"RED control observed: {label} refused (excluded): {cite_path}")

# Exclusion casefold: the folder is Generated on disk, the exclusion row is generated.
exclusion_refused("in-package-exclusion-casefold-RED", "services/api/Generated/gen.py",
                  "services/api/Generated", "services/api/generated",
                  "services/api/Generated/gen.py", "services/api/Generated/gen.py")
# Unicode form of an excluded folder: the row names the NFC folder, the citation uses NFD.
exclusion_refused("in-package-exclusion-unicode-RED", "services/api/café/gen.py",
                  "services/api/café", "services/api/café",
                  "services/api/café/gen.py", "services/api/café/gen.py")

# Mixed-case ignored folder: pods on disk, cited as Pods.
write(inpkg_base / "apps/mobile/pods/x.swift", "let x = 1\nlet more = 2\n")
refused_in_package("in-package-case-pods-RED", "apps/mobile", "apps/mobile/Pods/x.swift", "ignored",
                   "apps/mobile/pods/x.swift")
# Wrong case on a citable file: SRC on disk is src.
either_reason("in-package-wrong-case-RED", "services/api", "services/api/SRC/helper.py",
              ("not the exact on-disk spelling", "missing"), "services/api/src/helper.py")
# Unicode form: the folder is NFC on disk, the citation is NFD.
write(inpkg_base / "services/api/café/mod.py", "def mod():\n    return 1\n")
either_reason("in-package-unicode-spelling-RED", "services/api", "services/api/café/mod.py",
              ("not the exact on-disk spelling", "missing"), "services/api/café/mod.py")

# Harness loop: the staged root loop.sh is the harness's placeholder, not project source.
write(inpkg_base / "loop.sh", "#!/usr/bin/env bash\n# Spec Harness minimal loop\nexit 0\n")
refused_in_package("in-package-harness-loop-RED", ".", "loop.sh", "harness file")

# Nested repository: a vendored tree with its own .git directory, one level below the package.
(inpkg_base / "services/api/thirdparty/.git").mkdir(parents=True, exist_ok=True)
write(inpkg_base / "services/api/thirdparty/lib.py", "def lib():\n    return 1\n")
refused_in_package("in-package-nested-repo-RED", "services/api", "services/api/thirdparty/lib.py", "nested repository")

# Size cap: one byte over the 128 KiB in-package read limit is refused; exactly 128 KiB is citable.
write(inpkg_base / "services/api/src/large.py", "value = 1\n" * 13107 + "##\n")
refused_in_package("in-package-too-large-RED", "services/api", "services/api/src/large.py", "too large")
write(inpkg_base / "services/api/src/limit.py", "value = 1\n" * 13107 + "#\n")
assert (inpkg_base / "services/api/src/limit.py").stat().st_size == 128 * 1024
inpkg_check("in-package-size-limit-GREEN", add_skill_citation(inpkg_citation("services/api", "services/api/src/limit.py")),
            0, "READY:")
print("PASS: an in-package source of exactly 128 KiB is still citable")

# Secret-like names: the basename, folded with -, _ and . removed, contains a secret word.
for rel in ("services/api/src/secrets.py", "services/api/src/api_key.py", "services/api/src/authToken.py"):
    write(inpkg_base / rel, "value = 1\nmore = 2\n")
refused_in_package("in-package-secret-name-RED", "services/api", "services/api/src/secrets.py", "secret-like name")
refused_in_package("in-package-api-key-name-RED", "services/api", "services/api/src/api_key.py", "secret-like name")
refused_in_package("in-package-auth-token-name-RED", "services/api", "services/api/src/authToken.py", "secret-like name")
# GREEN: an ordinary in-package name still passes the new rules.
inpkg_check("in-package-ordinary-name-GREEN", add_skill_citation(inpkg_citation("services/api", "services/api/src/main.py")),
            0, "READY:")
print("PASS: an ordinary in-package source name is still citable")

# An explicit --exclude-dir is an inventory exclusion. The index is rebuilt for this disposable copy,
# so the receipt and the bound skill and role files must follow its new inventory hash.
excluded = tmp / "in-package-excluded"
shutil.copytree(inpkg_base, excluded, symlinks=True)
write(excluded / "services/api/generated/gen.py", "def gen():\n    return 2\n")
run(["bash", str(index), str(excluded), "--exclude-dir", "services/api/generated"], 0, "index with explicit exclusion")
excluded_hash = sha(excluded / "ai_rules/project_inventory.json")
excluded_receipt = copy.deepcopy(receipt)
excluded_receipt["inventory_sha256"] = excluded_hash
for row in excluded_receipt["skills"] + excluded_receipt["roles"]:
    file = excluded / row["path"]
    file.write_text(file.read_text().replace(inventory_hash, excluded_hash))
    row["sha256"] = sha(file)
cite_in_file(excluded, excluded_receipt["skills"][0], [
    {"package_path": "services/api", "path": "services/api/generated/gen.py", "line_start": 1, "line_end": 2,
     "sha256": sha(excluded / "services/api/generated/gen.py")}
])
write(excluded / ".claude/agents/.init-synthesis.json", json.dumps(excluded_receipt, indent=2) + "\n")
excluded_out = run(["bash", str(bind), "--check", str(excluded)], 1, "in-package excluded directory RED control")
assert "and not an in-package source file for package services/api (excluded): services/api/generated/gen.py" in excluded_out, excluded_out
print("RED control observed: a file under an inventory exclusion is refused")

# Round 1, context_map route: a generated Markdown inventory lists its excluded paths as "- `path`:" rows
# under "## Excluded paths and limitations". A citation under one of them is refused as excluded.
ctx_excluded = tmp / "in-package-context-map-excluded"
shutil.copytree(mixed, ctx_excluded, symlinks=True)
(ctx_excluded / "ai_rules/context_map.md").unlink()
write(ctx_excluded / "services/api/generated/gen.py", "def gen():\n    return 2\n")
run(["bash", str(index), str(ctx_excluded), "--exclude-dir", "services/api/generated"], 0, "context map with explicit exclusion")
ctx_map = ctx_excluded / "ai_rules/context_map.md"
assert "## Excluded paths and limitations" in ctx_map.read_text() and "- `services/api/generated`:" in ctx_map.read_text()
ctx_hash = sha(ctx_map)
ctx_receipt = copy.deepcopy(receipt)
ctx_receipt["inventory_path"] = "ai_rules/context_map.md"
ctx_receipt["inventory_sha256"] = ctx_hash
for row in ctx_receipt["skills"] + ctx_receipt["roles"]:
    file = ctx_excluded / row["path"]
    file.write_text(file.read_text().replace(receipt["inventory_sha256"], ctx_hash))
    row["sha256"] = sha(file)
write(ctx_excluded / ".claude/agents/.init-synthesis.json", json.dumps(ctx_receipt, indent=2) + "\n")
run(["bash", str(bind), "--check", str(ctx_excluded)], 0, "context map rebound before the exclusion citation GREEN control")
cite_in_file(ctx_excluded, ctx_receipt["skills"][0], [
    {"package_path": "services/api", "path": "services/api/generated/gen.py", "line_start": 1, "line_end": 2,
     "sha256": sha(ctx_excluded / "services/api/generated/gen.py")}
])
write(ctx_excluded / ".claude/agents/.init-synthesis.json", json.dumps(ctx_receipt, indent=2) + "\n")
ctx_out = run(["bash", str(bind), "--check", str(ctx_excluded)], 1, "context-map exclusion RED control")
assert "and not an in-package source file for package services/api (excluded): services/api/generated/gen.py" in ctx_out, ctx_out
print("RED control observed: a file under a context-map exclusion row is refused")

# Contract: the copied sets in the generator must stay equal to the indexer's sets.
index_text = index.read_text()
bind_text = bind.read_text()
def literal_set(text, name):
    match = re.search(rf"^{name} = (\{{[^}}]*\}})", text, re.M)
    assert match, f"{name} is not defined as a literal set"
    return set(ast.literal_eval(match.group(1)))
for name in ("SOURCE_SUFFIXES", "SOURCE_NAMES", "IGNORED_DIRS", "PRIVATE_DIRS", "DATA_DIRS", "DATA_SUFFIXES"):
    left, right = literal_set(index_text, name), literal_set(bind_text, name)
    assert left and left == right, (name, sorted(left ^ right))
print("PASS: SOURCE_SUFFIXES, SOURCE_NAMES, IGNORED_DIRS, PRIVATE_DIRS, DATA_DIRS and DATA_SUFFIXES are equal in both scripts")
# Correction round 2: the in-package read limit and the harness loop marker are copied from the indexer.
size_line = r"^MAX_SOURCE_BYTES = .*$"
assert re.search(size_line, index_text, re.M) and re.search(size_line, bind_text, re.M), "MAX_SOURCE_BYTES is not defined in both scripts"
assert re.search(size_line, index_text, re.M).group(0) == re.search(size_line, bind_text, re.M).group(0), "MAX_SOURCE_BYTES differs"
loop_marker = "# Spec Harness minimal loop"
assert loop_marker in index_text and loop_marker in bind_text, "harness loop marker differs between the scripts"
print("PASS: MAX_SOURCE_BYTES and the harness loop marker are equal in both scripts")
# Round 1: the file-class rule and its GENERATED_PATTERNS are copied as code, so compare their syntax trees.
def copied_block(text, pattern):
    match = re.search(pattern, text, re.M)
    assert match, pattern
    return ast.dump(ast.parse(match.group(0)))
for label, pattern in (
    ("hidden_or_private_file", r"^def hidden_or_private_file\(name\):\n(?:(?:[ \t].*)?\n)*"),
    ("GENERATED_PATTERNS", r"^GENERATED_PATTERNS = \(\n(?:[ \t].*\n)*\)\n"),
):
    assert copied_block(index_text, pattern) == copied_block(bind_text, pattern), label
print("PASS: hidden_or_private_file and GENERATED_PATTERNS are the same code in both scripts")

# The project lens is not a rule file: a lens line is never read as a rule, whatever its shape.
write(mixed / "ai_rules/review-lens.md", "# Review lens\n- **LENS-1** A check with no source tag.\n- **LENS-2** Another check. (source: nowhere)\n- not a rule line at all\n")
assert "READY:" in run(["bash", str(bind), "--check", str(mixed)], 0, "review lens is not parsed as a rule file")
(mixed / "ai_rules/review-lens.md").unlink()
print("PASS: ai_rules/review-lens.md is never registered or parsed as a rule file")

# Guarded-refresh controls run only in a disposable initialized target. A source
# citation edit goes RED; a raw inventory marker change then exercises every
# receipt-owned marker consumer and preserves role bytes outside GEN.
refresh_target = tmp / "guarded-refresh"
shutil.copytree(mixed, refresh_target)
refresh_receipt_path = refresh_target / ".claude/agents/.init-synthesis.json"
refresh_receipt = json.loads(refresh_receipt_path.read_text())
first_citation = refresh_receipt["packages"][0]["citations"][0]
changed_source = refresh_target / first_citation["path"]
source_preimage = changed_source.read_bytes()
changed_source.write_bytes(source_preimage + b"\n# controlled source evolution\n")
source_red = run(["bash", str(bind), "--check", str(refresh_target)], 1, "stale source RED control")
assert "source citation hash is fake or stale" in source_red
print("RED control observed: source evolution invalidates the old citation")

# Restore the controlled source before changing only the raw inventory bytes.
changed_source.write_bytes(source_preimage)
inventory_file = refresh_target / refresh_receipt["inventory_path"]
old_inventory_hash = sha(inventory_file)
old_marker_consumers = []
for row in refresh_receipt["skills"]:
    old_marker_consumers.append(("skill", row["name"], refresh_target / row["path"]))
for row in refresh_receipt["roles"]:
    role_file = refresh_target / row["path"]
    old_marker_consumers.append(("role", row["name"], role_file))
inventory_file.write_bytes(inventory_file.read_bytes() + b" ")
new_inventory_hash = sha(inventory_file)
inventory_red = run(["bash", str(bind), "--check", str(refresh_target)], 1, "stale inventory RED control")
assert "inventory hash changed; refresh affected synthesis outputs" in inventory_red
print(f"RED control observed: {len(old_marker_consumers)} marker consumers stale after inventory hash change")

outside_gen_preimages = {}
for kind, name, file in old_marker_consumers:
    text = file.read_text()
    if kind == "skill":
        assert f"inventory-sha256={old_inventory_hash}" in text
        text = text.replace(old_inventory_hash, new_inventory_hash)
    else:
        start = text.index("<!-- GEN:rules START -->")
        end = text.index("<!-- GEN:rules END -->") + len("<!-- GEN:rules END -->")
        outside_gen_preimages[name] = text[:start] + text[end:]
        generated = text[start:end]
        assert f"inventory-sha256={old_inventory_hash}" in generated
        text = text[:start] + generated.replace(old_inventory_hash, new_inventory_hash) + text[end:]
    file.write_text(text)
    row_set = refresh_receipt["skills"] if kind == "skill" else refresh_receipt["roles"]
    next(row for row in row_set if row["name"] == name)["sha256"] = sha(file)
refresh_receipt["inventory_sha256"] = new_inventory_hash
write(refresh_receipt_path, json.dumps(refresh_receipt, indent=2) + "\n")
for kind, name, file in old_marker_consumers:
    text = file.read_text()
    marker = f"inventory-sha256={new_inventory_hash}"
    if kind == "skill":
        assert marker in text
    else:
        start = text.index("<!-- GEN:rules START -->")
        end = text.index("<!-- GEN:rules END -->") + len("<!-- GEN:rules END -->")
        assert marker in text[start:end]
        assert outside_gen_preimages[name] == text[:start] + text[end:]
assert len([item for item in old_marker_consumers if item[0] == "skill"]) == 3
assert "READY: 3 packages, 3 skills, 5 selected roles" in run(
    ["bash", str(bind), "--check", str(refresh_target)], 0, "guarded marker refresh GREEN control"
)
print(f"GREEN control observed: refreshed and rechecked all {len(old_marker_consumers)} raw-inventory marker consumers")

# A post-receipt custom skill edit remains byte-identical and cannot be blessed
# by merely updating the inventory marker in the receipt.
custom_refresh = tmp / "custom-refresh"
shutil.copytree(refresh_target, custom_refresh)
custom_skill = custom_refresh / refresh_receipt["skills"][0]["path"]
custom_skill.write_bytes(custom_skill.read_bytes() + b"\nuser policy\n")
custom_preimage = custom_skill.read_bytes()
custom_red = run(["bash", str(bind), "--check", str(custom_refresh)], 1, "custom skill RED control")
assert "output is missing or stale" in custom_red
assert custom_skill.read_bytes() == custom_preimage
print("RED control observed: post-receipt custom skill remains byte-identical and PENDING")

# Schema 3: the policy-sources / policy-coverage ledger, with an optional package rule module.
# Schema 3 keeps schema 2's five core skills and adds the ledger and a policy drift check.
schema3 = tmp / "schema-3"
shutil.copytree(mixed, schema3)
s3_receipt = copy.deepcopy(receipt)
s3_receipt["schema_version"] = 3
root_citation = citations["."]
cited = f"{root_citation['path']}:{root_citation['line_start']}-{root_citation['line_end']}"
module_rel = "ai_rules/rules/coding.md"
write(schema3 / module_rel, "# Coding module\n\n<!-- source-bound: inventory-sha256=" + inventory_hash + " -->\n- [OBSERVED] Keep exports explicit. Evidence: " + cited + "\n")
root_rules = schema3 / "RULES.md"
root_rules.write_text(root_rules.read_text() + "\n## Modules\n- [coding](ai_rules/rules/coding.md)\n")
root_row = next(row for row in s3_receipt["packages"] if row["path"] == ".")
root_row["sha256"] = sha(root_rules)
root_row["rule_modules"] = [{"name": "coding", "path": module_rel, "sha256": sha(schema3 / module_rel), "citations": [root_citation]}]
write(schema3 / "CONTRIBUTING.md", "# Contributing\n- Use named exports.\n- Ship release notes with each tag.\n")
s3_receipt["skills"] = [core_skill_row(schema3, name) for name in PURPOSE_CORE_2]
s3_path = schema3 / ".claude/agents/.init-synthesis.json"

def s3_rows_with_files(value):
    rows = [(row, schema3 / row["path"]) for row in value["skills"] + value["roles"]]
    rows += [(module, schema3 / module["path"]) for package in value["packages"] for module in package.get("rule_modules", [])]
    return rows

def s3_ledger(value):
    contributing = schema3 / "CONTRIBUTING.md"
    value["policy_sources"] = [{"path": "CONTRIBUTING.md", "sha256": sha(contributing), "requirement_ids": ["CONTRIB-1", "CONTRIB-2"]}]
    value["policy_coverage"] = [
        {"id": "CONTRIB-1", "path": "CONTRIBUTING.md", "sha256": sha(contributing), "line_start": 2, "line_end": 2,
         "disposition": "captured", "rule_path": module_rel, "rule_anchor": "Keep exports explicit"},
        {"id": "CONTRIB-2", "path": "CONTRIBUTING.md", "sha256": sha(contributing), "line_start": 3, "line_end": 3,
         "disposition": "not-applicable", "reason": "Release tagging is outside code changes in this fixture."},
    ]

# First write the receipt so the index sees the module as receipt-owned, then reindex and rebind
# every marker consumer to the new raw inventory hash.
s3_ledger(s3_receipt)
write(s3_path, json.dumps(s3_receipt, indent=2) + "\n")
run(["bash", str(index), str(schema3)], 0, "schema 3 reindex")
s3_inventory = schema3 / "ai_rules/project_inventory.json"
s3_hash = sha(s3_inventory)
s3_rows = json.loads(s3_inventory.read_text())["rule_files"]
assert next(row for row in s3_rows if row["path"] == module_rel).get("ownership") == "receipt-generated"
assert next(row for row in s3_rows if row["path"] == "RULES.md").get("ownership") == "receipt-generated"
for row, file in s3_rows_with_files(s3_receipt):
    file.write_text(file.read_text().replace(s3_receipt["inventory_sha256"], s3_hash))
    row["sha256"] = sha(file)
s3_receipt["inventory_sha256"] = s3_hash
write(s3_path, json.dumps(s3_receipt, indent=2) + "\n")
s3_green = run(["bash", str(bind), "--check", str(schema3)], 0, "schema 3 GREEN control")
assert "READY: 3 packages, 5 skills, 5 selected roles" in s3_green, s3_green
run(["bash", str(index), str(schema3)], 0, "schema 3 refresh fixed point")
assert sha(s3_inventory) == s3_hash, "rebinding a receipt-owned module changed the inventory"
assert "READY:" in run(["bash", str(bind), "--check", str(schema3)], 0, "schema 3 GREEN after reindex")
print("PASS: schema 3 receipt with a policy ledger and a rule module is READY; reindex is a fixed point")

def s3_red(label, mutate, needle, files=()):
    saved = {path: path.read_bytes() for path in [s3_path, *files]}
    try:
        value = copy.deepcopy(s3_receipt)
        mutate(value)
        write(s3_path, json.dumps(value, indent=2) + "\n")
        output = run(["bash", str(bind), "--check", str(schema3)], 1, label)
        assert needle in output, (label, output)
        print("RED control observed: schema 3 " + label + " -> " + needle)
    finally:
        for path, data in saved.items():
            path.write_bytes(data)

s3_red("missing coverage row", lambda v: v["policy_coverage"].pop(), "policy source is missing coverage rows: CONTRIBUTING.md (CONTRIB-2)")
s3_red("missing ledger", lambda v: (v.pop("policy_sources"), v.pop("policy_coverage")), "schema 3 receipt is missing policy_sources")
s3_red("stale module hash", lambda v: (schema3 / module_rel).write_bytes((schema3 / module_rel).read_bytes() + b"edit\n"),
       "rule module is missing, unsafe or stale: ai_rules/rules/coding.md", files=(schema3 / module_rel,))
def unsafe_module(v):
    next(r for r in v["packages"] if r["path"] == ".")["rule_modules"][0]["path"] = "../coding.md"
s3_red("unsafe module path", unsafe_module, "rule module path is unsafe or not package-scoped")
def cross_package_module(v):
    next(r for r in v["packages"] if r["path"] == ".")["rule_modules"][0]["path"] = "apps/mobile/ai_rules/rules/coding.md"
s3_red("module outside its package", cross_package_module, "rule module path is unsafe or not package-scoped")
def owner_decision(v):
    v["policy_coverage"][1]["disposition"] = "owner-decision"
s3_red("owner decision", owner_decision, "policy requirement CONTRIB-2 remains owner-decision")
def captured_without_anchor(v):
    v["policy_coverage"][0]["rule_anchor"] = "text that is not in the module"
s3_red("captured without anchor", captured_without_anchor, "captured policy requirement CONTRIB-1 has no registered rule output")
s3_red("stale policy source", lambda v: (schema3 / "CONTRIBUTING.md").write_text("# Contributing\n- changed\n- policy\n"),
       "policy source is missing, unsafe or stale: CONTRIBUTING.md", files=(schema3 / "CONTRIBUTING.md",))
s3_red("policy drift after indexing", lambda v: (schema3 / "ai_rules/rules/frequent_rules.md").write_text("# Frequent rules\n- A new rule after indexing.\n"),
       "project policy file changed after indexing: ai_rules/rules/frequent_rules.md", files=(schema3 / "ai_rules/rules/frequent_rules.md",))
s3_red("missing quality skill", lambda v: v.__setitem__("skills", [row for row in v["skills"] if row["name"] != "spec-harness-quality"]), "missing: spec-harness-quality")
assert "READY:" in run(["bash", str(bind), "--check", str(schema3)], 0, "schema 3 restored GREEN")
# The same target with a schema 2 receipt (no ledger) still validates: schema 2 keeps its meaning.
s2_value = copy.deepcopy(s3_receipt)
s2_value["schema_version"] = 2
del s2_value["policy_sources"], s2_value["policy_coverage"]
write(s3_path, json.dumps(s2_value, indent=2) + "\n")
assert "READY: 3 packages, 5 skills" in run(["bash", str(bind), "--check", str(schema3)], 0, "schema 2 without a ledger GREEN")
write(s3_path, json.dumps(s3_receipt, indent=2) + "\n")
print("PASS: schema 2 receipts keep validating without a ledger; schema 3 enforces it")

# Memory policy sources: a ledger row anchored by the hash of its own span text survives ordinary
# edits elsewhere in a .memory/ file (notes are added every session); its own text changing does not.
memory_rel = ".memory/40-active.md"
memory_file = schema3 / memory_rel
memory_text = "# Active\n\n- MEM-A Keep the cart badge in sync with the server cart.\n- MEM-B Ship the consent banner before analytics.\n"

def text_hash(text):
    return hashlib.sha256(text.encode()).hexdigest()

def span_sha(text, start, end):
    return text_hash("\n".join(text.splitlines()[start - 1:end]))

def memory_ledger(value, text=memory_text):
    file_hash = text_hash(text)
    value["policy_sources"].append({"path": memory_rel, "sha256": file_hash, "requirement_ids": ["MEM-A", "MEM-B"]})
    for requirement, line in (("MEM-A", 3), ("MEM-B", 4)):
        value["policy_coverage"].append({"id": requirement, "path": memory_rel, "sha256": file_hash, "line_start": line, "line_end": line,
                                         "text_sha256": span_sha(text, line, line), "disposition": "not-applicable",
                                         "reason": "Product note, not a code rule, in this fixture."})

mem_receipt = copy.deepcopy(s3_receipt)
memory_ledger(mem_receipt)

def mem_check(label, memory_after, expect_exit, needle, mutate=None, files=(), memory_path=memory_file):
    saved = {path: path.read_bytes() for path in [s3_path, *files] if path.exists()}
    try:
        value = copy.deepcopy(mem_receipt)
        if mutate:
            mutate(value)
        write(s3_path, json.dumps(value, indent=2) + "\n")
        write(memory_path, memory_after)
        output = run(["bash", str(bind), "--check", str(schema3)], expect_exit, label)
        assert needle in output, (label, output)
        print(("GREEN" if expect_exit == 0 else "RED") + " control observed: memory ledger " + label + " -> " + needle)
        return output
    finally:
        for path, data in saved.items():
            path.write_bytes(data)
        if memory_path.exists():
            memory_path.unlink()
            memory_path.parent.rmdir()

unchanged = mem_check("unchanged with text anchors", memory_text, 0, "READY: 3 packages")
assert "NOTE:" not in unchanged, unchanged
appended = mem_check("note appended", memory_text + "- 2026-10-28 New note from another session.\n", 0, "READY: 3 packages")
assert "NOTE: memory policy source changed since synthesis; 2 ledger rows found by text (0 moved): .memory/40-active.md" in appended, appended
moved = mem_check("note inserted above the rows", memory_text.replace("\n\n", "\n\n- 2026-10-28 Inserted note.\n", 1), 0, "READY: 3 packages")
assert "2 ledger rows found by text (2 moved): .memory/40-active.md" in moved, moved
mem_check("row text edited", memory_text.replace("server cart", "local cart"), 1,
          "policy requirement MEM-A: its text in .memory/40-active.md changed or is gone; re-ground this ledger row")
mem_check("row text deleted", memory_text.replace("- MEM-B Ship the consent banner before analytics.\n", ""), 1,
          "policy requirement MEM-B: its text in .memory/40-active.md changed or is gone; re-ground this ledger row")
mem_check("row without a text anchor", memory_text + "- extra note\n", 1,
          "policy source is missing, unsafe or stale: .memory/40-active.md (memory source: give each of its ledger rows a text_sha256",
          mutate=lambda v: v["policy_coverage"][-1].pop("text_sha256"))
mem_check("moved text found twice", "# Active\n\n- a new note\n- MEM-A Keep the cart badge in sync with the server cart.\n- MEM-A Keep the cart badge in sync with the server cart.\n- MEM-B Ship the consent banner before analytics.\n", 1,
          "policy requirement MEM-A: its text appears more than once in .memory/40-active.md")
mem_check("wrong text anchor on an unchanged source", memory_text, 1, "policy requirement MEM-A: text_sha256 does not match its span",
          mutate=lambda v: v["policy_coverage"][-2].__setitem__("text_sha256", "0" * 64))
mem_check("malformed text anchor", memory_text, 1, "policy requirement MEM-A: malformed text_sha256",
          mutate=lambda v: v["policy_coverage"][-2].__setitem__("text_sha256", "ABC"))
contributing = schema3 / "CONTRIBUTING.md"
def changed_contributing(v):
    text = contributing.read_text()
    for row in v["policy_coverage"]:
        if row["path"] == "CONTRIBUTING.md":
            row["text_sha256"] = span_sha(text, row["line_start"], row["line_end"])
    contributing.write_text(text + "- new line\n")
mem_check("non-memory source changed with text anchors", memory_text, 1, "policy source is missing, unsafe or stale: CONTRIBUTING.md",
          mutate=changed_contributing, files=(contributing,))
# Only the exact .memory/ prefix is memory; look-alike folders keep the strict whole-file check.
for lookalike in (".memoryx/40-active.md", ".Memory/40-active.md"):
    def as_lookalike(v, lookalike=lookalike):
        for row in v["policy_sources"] + v["policy_coverage"]:
            if row["path"] == memory_rel:
                row["path"] = lookalike
    mem_check("look-alike path " + lookalike, memory_text + "- extra note\n", 1, "policy source is missing, unsafe or stale: " + lookalike,
              mutate=as_lookalike, memory_path=schema3 / lookalike)
# A changed memory source still runs every disposition check on rows found at their span.
for disposition in ("owner-decision", "conflict"):
    mem_check(disposition + " row with a note appended", memory_text + "- extra note\n", 1, f"policy requirement MEM-A remains {disposition}",
              mutate=lambda v, disposition=disposition: v["policy_coverage"][-2].__setitem__("disposition", disposition))
mem_check("unknown disposition with a note appended", memory_text + "- extra note\n", 1, "policy_coverage MEM-A has an unknown disposition",
          mutate=lambda v: v["policy_coverage"][-2].__setitem__("disposition", "whatever"))
# The anchor must be the requirement itself.
heading_text = memory_text.replace("- MEM-A", "## Cart\n- MEM-A")
def anchor_heading(v):
    for row in v["policy_sources"] + v["policy_coverage"]:
        if row["path"] == memory_rel:
            row["sha256"] = text_hash(heading_text)
    row = v["policy_coverage"][-2]
    row.update(line_start=3, line_end=3, text_sha256=span_sha(heading_text, 3, 3))
    v["policy_coverage"][-1].update(line_start=5, line_end=5, text_sha256=span_sha(heading_text, 5, 5))
mem_check("heading-only anchor", heading_text, 1, "policy requirement MEM-A: its span holds only blank or heading lines", mutate=anchor_heading)
mem_check("heading-only anchor, requirement rewritten", heading_text.replace("server cart", "local cart"), 1,
          "policy requirement MEM-A: its span holds only blank or heading lines", mutate=anchor_heading)
mem_check("heading-only anchor, moved", heading_text.replace("\n\n", "\n\n- a new note\n", 1), 1,
          "policy requirement MEM-A: its span holds only blank or heading lines", mutate=anchor_heading)
partial_text = memory_text.replace("server cart.\n", "server cart\n  and refresh it after login.\n")
def anchor_partial(v):
    for row in v["policy_sources"] + v["policy_coverage"]:
        if row["path"] == memory_rel:
            row["sha256"] = text_hash(partial_text)
    v["policy_coverage"][-2].update(text_sha256=span_sha(partial_text, 3, 3))
    v["policy_coverage"][-1].update(line_start=5, line_end=5, text_sha256=span_sha(partial_text, 5, 5))
mem_check("span stops inside an item", partial_text.replace("after login", "never"), 1,
          "policy requirement MEM-A: its span stops inside an item", mutate=anchor_partial)
# Round 3: a loose list item continues after a blank line; separate loose items do not.
loose_text = memory_text.replace("server cart.\n", "server cart.\n\n  Only after login.\n\n")
def anchor_loose(v):
    for row in v["policy_sources"] + v["policy_coverage"]:
        if row["path"] == memory_rel:
            row["sha256"] = text_hash(loose_text)
    v["policy_coverage"][-2].update(text_sha256=span_sha(loose_text, 3, 3))
    v["policy_coverage"][-1].update(line_start=7, line_end=7, text_sha256=span_sha(loose_text, 7, 7))
mem_check("loose item continued after a blank line", loose_text.replace("Only after login", "Never"), 1,
          "policy requirement MEM-A: its span stops inside an item", mutate=anchor_loose)
spaced_text = memory_text.replace("server cart.\n", "server cart.\n\n")
def anchor_spaced(v):
    for row in v["policy_sources"] + v["policy_coverage"]:
        if row["path"] == memory_rel:
            row["sha256"] = text_hash(spaced_text)
    v["policy_coverage"][-2].update(text_sha256=span_sha(spaced_text, 3, 3))
    v["policy_coverage"][-1].update(line_start=5, line_end=5, text_sha256=span_sha(spaced_text, 5, 5))
mem_check("separate loose items, note appended", spaced_text + "\n- 2026-10-28 note\n", 0, "READY: 3 packages", mutate=anchor_spaced)
# A second entry for the same source would replace the first one's requirement_ids and hide MEM-B.
def duplicate_source(v):
    first = next(row for row in v["policy_sources"] if row["path"] == memory_rel)
    v["policy_sources"].append(dict(first, requirement_ids=["MEM-A"]))
    v["policy_coverage"] = [row for row in v["policy_coverage"] if row["id"] != "MEM-B"]
mem_check("policy source listed twice", memory_text, 1, "policy_sources lists a path more than once: .memory/40-active.md", mutate=duplicate_source)
mem_check("policy source listed twice, note appended", memory_text + "- extra note\n", 1,
          "policy_sources lists a path more than once: .memory/40-active.md", mutate=duplicate_source)
# Shapes that must not reach the text path.
def fake_source_hash(v):
    for row in v["policy_sources"] + v["policy_coverage"]:
        if row["path"] == memory_rel:
            row["sha256"] = "x"
mem_check("memory source sha256 not a hash", memory_text, 1, "policy source is missing, unsafe or stale: .memory/40-active.md", mutate=fake_source_hash)
mem_check("string line number on a changed memory source", memory_text + "- extra note\n", 1,
          "policy_coverage MEM-A has an invalid source span: .memory/40-active.md:3-3",
          mutate=lambda v: v["policy_coverage"][-2].__setitem__("line_start", "3"))
mem_check("boolean line number", memory_text, 1, "policy_coverage MEM-A has an invalid source span: .memory/40-active.md:True-3",
          mutate=lambda v: v["policy_coverage"][-2].__setitem__("line_start", True))
# Round 2: null is not absent; nested bullets are separate items; a plain next line continues the requirement.
mem_check("null text anchor, requirement rewritten", memory_text.replace("server cart", "local cart") + "- extra note\n", 1,
          "policy requirement MEM-A: malformed text_sha256", mutate=lambda v: v["policy_coverage"][-2].__setitem__("text_sha256", None))
nested_text = "# Active\n\n- Cart\n  - MEM-A Keep the cart badge in sync with the server cart.\n  - MEM-B Ship the consent banner before analytics.\n"
def anchor_nested(v, text=nested_text):
    for row in v["policy_sources"] + v["policy_coverage"]:
        if row["path"] == memory_rel:
            row["sha256"] = text_hash(nested_text)
    v["policy_coverage"][-2].update(line_start=4, line_end=4, text_sha256=span_sha(nested_text, 4, 4))
    v["policy_coverage"][-1].update(line_start=5, line_end=5, text_sha256=span_sha(nested_text, 5, 5))
mem_check("sibling sub-bullets, note appended", nested_text + "- 2026-10-28 note\n", 0, "READY: 3 packages", mutate=anchor_nested)
# Labelled lines at the same indent are separate fields (a common memory format), not one paragraph.
labelled_text = "# Active\n\nCorrection: keep the cart badge in sync with the server cart.\nEvidence: the cart screen reads the server cart.\nMEM-B Ship the consent banner before analytics.\n"
def anchor_labelled(v):
    for row in v["policy_sources"] + v["policy_coverage"]:
        if row["path"] == memory_rel:
            row["sha256"] = text_hash(labelled_text)
    v["policy_coverage"][-2].update(text_sha256=span_sha(labelled_text, 3, 3))
    v["policy_coverage"][-1].update(line_start=5, line_end=5, text_sha256=span_sha(labelled_text, 5, 5))
mem_check("labelled lines, note appended", labelled_text + "Note: 2026-10-28 another session.\n", 0, "READY: 3 packages", mutate=anchor_labelled)
mem_check("captured row without its anchor, note appended", memory_text + "- extra note\n", 1,
          "captured policy requirement MEM-A has no registered rule output containing its anchor",
          mutate=lambda v: v["policy_coverage"][-2].update(disposition="captured", rule_path=module_rel, rule_anchor="text that is not in the module"))
def int_source_hash(v):
    for row in v["policy_sources"] + v["policy_coverage"]:
        if row["path"] == memory_rel:
            row["sha256"] = 7
mem_check("memory source sha256 not a string", memory_text, 1, "policy source is missing, unsafe or stale: .memory/40-active.md", mutate=int_source_hash)
assert not (schema3 / ".memory").exists()
assert "READY:" in run(["bash", str(bind), "--check", str(schema3)], 0, "schema 3 restored GREEN after memory controls")
print("PASS: memory ledger rows anchored by text survive ordinary memory edits; their own text changing still fails")

print("All synthesis contract fixtures passed.")
PY
