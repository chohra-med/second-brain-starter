"""Build a small target whose `generate-agents --check` prints READY. Shared by contract tests.

The inventory is written first and the synthesis outputs after it, as in a real initialization, so a
later `index` sees more files: that is the binding-only refresh finalize-init exists for.
"""
import hashlib
import json
import subprocess
from pathlib import Path

CORE = ["spec-harness-architecture", "spec-harness-performance", "spec-harness-packages",
        "spec-harness-quality", "spec-harness-conduct"]
ROLES = ["sdd-planner", "sdd-implementer", "sdd-tester", "sdd-verifier", "sdd-reviewer"]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text if isinstance(text, bytes) else text.encode())
    return path


def build(root, harness, index_args=()):
    root, harness = Path(root), Path(harness)
    write(root / "package.json", '{"name":"ready-fixture","scripts":{"test":"jest"},"dependencies":{"react":"18.3.1"}}\n')
    write(root / "src/App.tsx", "export function App() {\n  return null;\n}\n")
    write(root / "ai_rules/context_map.md", "# Team map\nKept as written.\n")
    write(root / "ai_rules/rules/frequent_rules.md", "# Frequent rules\n- Read the package rules before a change.\n")
    result = subprocess.run(["bash", str(harness / "bin/sh-index.sh"), str(root), *index_args], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    inventory_path = root / "ai_rules/project_inventory.json"
    inventory = json.loads(inventory_path.read_text())
    inventory_hash = sha(inventory_path.read_bytes())
    source = next(row for row in inventory["packages"][0]["representative_sources"] if row["read_status"] == "read")
    citation = {"package_path": ".", "path": source["path"], "line_start": 1, "line_end": 2, "sha256": source["sha256"]}
    cited = f"{source['path']}:1-2"
    marker = f"<!-- source-bound: inventory-sha256={inventory_hash} -->"
    module = write(root / "ai_rules/rules/coding.md", f"# Coding\n\n{marker}\n- [OBSERVED] Export named functions. Evidence: {cited}\n")
    rules = write(root / "RULES.md", "".join(f"## {name}\n- [OBSERVED] Follow the opened source. Evidence: {cited}\n\n" for name in ("Coding", "Architecture", "Packages", "Testing", "Reviewing")) + "## Modules\n- [coding](ai_rules/rules/coding.md)\n")
    skills = []
    for name in CORE:
        path = f".claude/skills/{name}/SKILL.md"
        file = write(root / path, f"# {name}\n\nPackage applicability: .\n\n{marker}\nEvidence: {cited}\n")
        skills.append({"name": name, "status": "READY", "path": path, "sha256": sha(file.read_bytes()),
                       "package_paths": ["."], "citations": [citation]})
    roles = []
    for name in ROLES:
        path = f".claude/agents/{name}.md"
        fresh = "Run in a fresh context.\n" if name in ("sdd-tester", "sdd-verifier", "sdd-reviewer") else ""
        file = write(root / path, f"# {name}\n\nRole text outside the generated block.\n\n<!-- GEN:rules START -->\nPackage: .\n[OBSERVED] Follow {cited}.\n{fresh}<!-- bound: 2026-10-13 inventory-sha256={inventory_hash} -->\n<!-- GEN:rules END -->\n\nMore role text.\n")
        roles.append({"name": name, "status": "BOUND", "path": path, "sha256": sha(file.read_bytes()),
                      "package_paths": ["."], "citations": [citation], "selection_reason": "Required role."})
    receipt = {
        "format": "spec-harness-synthesis", "schema_version": 2, "status": "READY",
        "inventory_path": "ai_rules/project_inventory.json", "inventory_sha256": inventory_hash,
        "package_paths": ["."],
        "packages": [{"path": ".", "status": "READY", "rules_path": "RULES.md", "sha256": sha(rules.read_bytes()),
                      "citations": [citation],
                      "rule_modules": [{"name": "coding", "path": "ai_rules/rules/coding.md", "sha256": sha(module.read_bytes()), "citations": [citation]}]}],
        "skills": skills, "roles": roles, "excluded_roles": [], "pending_reasons": [],
    }
    write(root / ".claude/agents/.init-synthesis.json", json.dumps(receipt, indent=2) + "\n")
    check = subprocess.run(["bash", str(harness / "bin/sh-gen-agents.sh"), "--check", str(root)], capture_output=True, text=True)
    assert check.returncode == 0, check.stdout + check.stderr
    return receipt


def snapshot(root):
    root = Path(root)
    return {path.relative_to(root).as_posix(): path.read_bytes() for path in sorted(root.rglob("*")) if path.is_file() and not path.is_symlink()}
