#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
if [ -n "$TMPDIR" ]; then
  TMP="$(mktemp -d "$TMPDIR/sh-synthesis-contract.XXXXXX")"
else
  TMP="$(mktemp -d /tmp/sh-synthesis-contract.XXXXXX)"
fi
trap 'rm -rf "$TMP"' EXIT

for file in bin/sh-gen-agents.sh bin/sh-make-skills.sh; do
  bash -n "$ROOT/$file"
done
echo "PASS: generator shell syntax"

python3 - "$ROOT" "$TMP" <<'PY'
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
    run(["python3", "-c", "pass"], 1, "expected-failure helper positive control")
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
assert "preserve its bytes and record `CONFLICT/PENDING`" in prompt
assert sha(conflict_target / ".claude/skills/spec-harness-performance/SKILL.md") == conflict_hash
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
for label, bad in (("bool-true", True), ("float-2.0", 2.0), ("string-2", "2"), ("integer-3", 3)):
    rejected = purpose_check(f"purpose-schema-bad-{label}", bad, PURPOSE_CORE_2, 1)
    assert "schema_version must be" in rejected, (label, rejected)
print("PASS: schema 1 accepts three core skills; schema 2 accepts five and names a missing quality or conduct skill")
print("PASS: schema_version true, 2.0, \"2\" and 3 are rejected; only integer 1 or 2 is accepted")

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
""")
root_rules_path = human_examples / "RULES.md"
with root_rules_path.open("a") as file:
    file.write("\n## Preserved human examples\n\n")
    file.write("JSX: `<View style={{ marginTop: 16 }}>...</View>`.\n")
    file.write("JSX shorthand: `<Component data={{value}} />`.\n")
    file.write("JSX uppercase prop: `<Component data={{MY_VALUE}} />`.\n")
    file.write("TypeScript generic: `useRef<any>(null)`.\n")
root_rules_row = next(row for row in human_receipt["packages"] if row["path"] == ".")
root_rules_row["sha256"] = sha(root_rules_path)
write(human_receipt_path, json.dumps(human_receipt, indent=2) + "\n")
human_green = run(["bash", str(bind), "--check", str(human_examples)], 0, "human JSX/generic examples GREEN control")
assert "READY: 3 packages, 3 skills, 5 selected roles" in human_green
print("PASS: readiness accepts human JSX and generic examples")

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
run(["bash", str(index), str(markdown_target)], 0, "generate context map for fallback GREEN control")
markdown_map = markdown_target / "ai_rules/context_map.md"
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

print("All synthesis contract fixtures passed.")
PY
