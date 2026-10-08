#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
INDEX="$ROOT/bin/sh-index.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-index-fixtures.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$*"; }

mkdir -p "$TMP/expo/src" "$TMP/python/src" "$TMP/library/src"
cat > "$TMP/expo/package.json" <<'JSON'
{"name":"expo-fixture","scripts":{"start":"expo start","test":"jest"},"dependencies":{"expo":"~53.0.0","react-native":"*"}}
JSON
cat > "$TMP/expo/app.json" <<'JSON'
{"expo":{"name":"Fixture"}}
JSON
cat > "$TMP/expo/src/App.tsx" <<'TS'
export default function App() { return null; }
TS
cat > "$TMP/python/pyproject.toml" <<'TOML'
[project]
name = "python-fixture"
dependencies = ["fastapi>=0.1", "uvicorn"]

[project.scripts]
serve = "app:main"
TOML
cat > "$TMP/python/src/main.py" <<'PY'
def main():
    return "ok"
PY
cat > "$TMP/library/package.json" <<'JSON'
{"name":"ts-library-fixture","scripts":{"build":"tsc","test":"vitest"},"dependencies":{"zod":"^3.0.0"},"types":"src/index.ts"}
JSON
cat > "$TMP/library/src/index.ts" <<'TS'
export type Fixture = { ok: true };
TS

mkdir -p "$TMP/mixed/apps/mobile/src" "$TMP/mixed/packages/core/src" \
  "$TMP/mixed/services/api/src" "$TMP/mixed/examples/java" \
  "$TMP/mixed/examples/nestedrepo/.git/objects" "$TMP/mixed/apps/escaped" \
  "$TMP/mixed/apps/broken" \
  "$TMP/mixed/vendor/nested/.git" "$TMP/outside-package/src" \
  "$TMP/mixed/ai_rules"
cat > "$TMP/mixed/package.json" <<'JSON'
{"name":"mixed-workspace","private":true,"workspaces":["apps/*","packages/*"]}
JSON
cat > "$TMP/mixed/apps/mobile/package.json" <<'JSON'
{"name":"mobile-fixture","scripts":{"start":"expo start"},"dependencies":{"expo":"~53.0.0","react-native":"*"}}
JSON
cat > "$TMP/mixed/apps/mobile/src/App.tsx" <<'TS'
export default function App() { return null; }
TS
cat > "$TMP/mixed/apps/mobile/.env.local" <<'ENV'
DO_NOT_READ=fixture-env-sentinel
ENV
printf '{ malformed json\n' > "$TMP/mixed/apps/broken/package.json"
cat > "$TMP/mixed/packages/core/package.json" <<'JSON'
{"name":"core-fixture","scripts":{"build":"tsc"},"dependencies":{"zod":"^3.0.0"}}
JSON
cat > "$TMP/mixed/packages/core/src/index.ts" <<'TS'
export const core = true;
TS
cat > "$TMP/mixed/services/api/pyproject.toml" <<'TOML'
[project]
name = "api-fixture"
dependencies = ["fastapi>=0.1", "uvicorn"]

[project.scripts]
serve = "api:main"
TOML
cat > "$TMP/mixed/services/api/RULES.md" <<'RULES'
# Python service rules
RULES
cat > "$TMP/mixed/services/api/src/main.py" <<'PY'
def main():
    return "api"
PY
cat > "$TMP/mixed/AGENTS.md" <<'RULES'
# Fixture instructions
RULES
cat > "$TMP/mixed/examples/java/pom.xml" <<'XML'
<project><modelVersion>4.0.0</modelVersion></project>
XML
cat > "$TMP/mixed/vendor/nested/package.json" <<'JSON'
{"name":"must-not-inventory-vendor"}
JSON
mkdir -p "$TMP/mixed/vendor/nested/.git/objects"
cat > "$TMP/mixed/vendor/nested/.git/HEAD" <<'GIT'
ref: refs/heads/main
GIT
cat > "$TMP/mixed/examples/nestedrepo/package.json" <<'JSON'
{"name":"must-not-inventory-nested-repo"}
JSON
cat > "$TMP/mixed/examples/nestedrepo/.git/HEAD" <<'GIT'
ref: refs/heads/main
GIT
cat > "$TMP/mixed/datasets.csv" <<'CSV'
private,data
CSV
mkdir -p "$TMP/mixed/dist"
cat > "$TMP/mixed/dist/generated.js" <<'JS'
generated code
JS
cat > "$TMP/outside-package/package.json" <<'JSON'
{"name":"outside-symlink-must-not-be-read"}
JSON
ln -s "$TMP/outside-package" "$TMP/mixed/linked-package"
ln -s "$TMP/outside-package/package.json" "$TMP/mixed/apps/escaped/package.json"
printf '# Malik-owned custom map\nKeep these bytes.\n' > "$TMP/mixed/ai_rules/context_map.md"
printf 'DO_NOT_READ=outside-sentinel\n' > "$TMP/outside-sentinel.txt"

# The default no-option inventory must remain byte-identical to the accepted
# baseline, while deeper first-party sources remain absent from its fixed sample.
mkdir -p "$TMP/selected/src/features/pagination" "$TMP/selected/ai_rules"
printf '{"name":"selected-source-fixture"}\n' > "$TMP/selected/package.json"
for letter in a b c d e; do
  printf 'export const %s = true;\n' "$letter" > "$TMP/selected/src/$letter.ts"
done
printf 'export const useHomePostList = true;\n' > "$TMP/selected/src/features/pagination/useHomePostList.ts"
printf '# custom context map\n' > "$TMP/selected/ai_rules/context_map.md"
bash "$INDEX" "$TMP/selected" > "$TMP/default.out"
[[ "$(shasum -a 256 "$TMP/selected/ai_rules/project_inventory.json" | awk '{print $1}')" == "28ed1328d6e26a3c6b148e618870f7c6db41383abcd191e48fe3ad112070e81a" ]] || fail 'default index output differs from prechange byte baseline'
python3 - "$TMP/selected/ai_rules/project_inventory.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
sources = [row["path"] for row in data["packages"][0]["representative_sources"]]
assert sources == [f"src/{letter}.ts" for letter in "abcde"], sources
print(f"Default source sample unchanged: {sources}")
PY
rm -rf "$TMP/selected"

mkdir -p "$TMP/selected/src/components/indexes" "$TMP/selected/src/store/api" \
  "$TMP/selected/src/hooks" "$TMP/selected/src/components/templates/HomePostListComponent" \
  "$TMP/selected/src/components/organisms/posts" "$TMP/selected/src/secrets" \
  "$TMP/selected/ai_rules"
printf '{"name":"selected-source-fixture"}\n' > "$TMP/selected/package.json"
printf 'export const decoy = true;\n' > "$TMP/selected/src/components/indexes/index.ts"
printf 'export const baseQuery = true;\n' > "$TMP/selected/src/store/api/baseApi.ts"
printf 'export const groups = true;\n' > "$TMP/selected/src/store/api/groupsApi.ts"
printf 'export const accumulator = true;\n' > "$TMP/selected/src/hooks/usePaginatedAccumulator.ts"
printf 'export const homeList = true;\n' > "$TMP/selected/src/components/templates/HomePostListComponent/useHomePostList.ts"
printf 'export const list = true;\n' > "$TMP/selected/src/components/organisms/posts/ListComponent.tsx"
printf 'private source fixture\n' > "$TMP/selected/src/secrets/credential.ts"
printf '# custom context map\n' > "$TMP/selected/ai_rules/context_map.md"
mkdir -p "$TMP/selected/.claude/agents" "$TMP/selected/.claude/skills"
SELECTED_SOURCES=(
  src/store/api/baseApi.ts
  src/store/api/groupsApi.ts
  src/hooks/usePaginatedAccumulator.ts
  src/components/templates/HomePostListComponent/useHomePostList.ts
  src/components/organisms/posts/ListComponent.tsx
)
index_selected() {
  local target="$1"
  shift
  local args=()
  for path in "${SELECTED_SOURCES[@]}"; do
    args+=(--source "$path")
  done
  bash "$INDEX" "$target" "${args[@]}" "$@"
}
bash "$INDEX" "$TMP/selected" > "$TMP/selected-default.out"
python3 - "$TMP/selected/ai_rules/project_inventory.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
sources = [row["path"] for row in data["packages"][0]["representative_sources"]]
assert sources == ["src/components/indexes/index.ts", "src/hooks/usePaginatedAccumulator.ts", "src/store/api/baseApi.ts", "src/store/api/groupsApi.ts", "src/components/organisms/posts/ListComponent.tsx"], sources
assert "src/components/templates/HomePostListComponent/useHomePostList.ts" not in sources
print(f"Default source sample remains bounded: {sources}")
PY
index_selected "$TMP/selected" > "$TMP/selected-explicit.out"
python3 - "$TMP/selected" "${SELECTED_SOURCES[@]}" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
expected = sys.argv[2:]
data = json.loads((root / "ai_rules/project_inventory.json").read_text())
assert [package["path"] for package in data["packages"]] == ["."]
rows = data["packages"][0]["representative_sources"]
assert [row["path"] for row in rows] == expected, rows
assert all(row["read_status"] == "read" for row in rows)
for row in rows:
    actual = hashlib.sha256((root / row["path"]).read_bytes()).hexdigest()
    assert row["sha256"] == actual, (row["path"], row["sha256"], actual)
print(f"Explicit source paths and independent SHA-256 verified: {expected}")
PY

source_hashes() {
  local base="$1"
  find "$base" -type f ! -path "$base/ai_rules/*" -print0 \
    | sort -z | xargs -0 shasum -a 256
}

selected_inventory="$TMP/selected/ai_rules/project_inventory.json"
selected_initial_hash="$(shasum -a 256 "$selected_inventory" | awk '{print $1}')"
cp "$selected_inventory" "$TMP/selected-inventory.initial"
printf '{"format":"spec-harness-synthesis","status":"PENDING"}\n' > "$TMP/selected/.claude/agents/.init-synthesis.json"
for skill in architecture performance packages; do
  mkdir -p "$TMP/selected/.claude/skills/spec-harness-$skill"
  printf '# Generated project skill fixture\n' > "$TMP/selected/.claude/skills/spec-harness-$skill/SKILL.md"
done
index_selected "$TMP/selected" > "$TMP/selected-repeat.out"
cmp -s "$TMP/selected-inventory.initial" "$selected_inventory" || fail 'inventory bytes moved when the generated receipt and three skills appeared'
pass 'inventory remains byte-identical after generated receipt and three project skills appear'

for skill in architecture performance packages; do
  mkdir -p "$TMP/selected/.claude/skills/spec-harness-$skill/local-context"
  printf '# Custom nested project file\n' > "$TMP/selected/.claude/skills/spec-harness-$skill/local-context/README.md"
done
index_selected "$TMP/selected" > "$TMP/selected-custom-skill-files.out"
custom_skill_hash="$(shasum -a 256 "$selected_inventory" | awk '{print $1}')"
[[ "$custom_skill_hash" != "$selected_initial_hash" ]] || fail 'custom files below generated skill leaves did not move inventory identity'
python3 - "$TMP/selected-inventory.initial" "$selected_inventory" <<'PY'
import json, sys
before = json.load(open(sys.argv[1], encoding="utf-8"))["scan"]
after = json.load(open(sys.argv[2], encoding="utf-8"))["scan"]
assert after["visited_files"] == before["visited_files"] + 3, (before, after)
assert after["visited_directories"] == before["visited_directories"] + 3, (before, after)
print("Nested custom files remain counted: +3 files and +3 directories.")
PY
for skill in architecture performance packages; do
  rm -rf "$TMP/selected/.claude/skills/spec-harness-$skill/local-context"
done
index_selected "$TMP/selected" > "$TMP/selected-custom-skill-files-restore.out"
cmp -s "$TMP/selected-inventory.initial" "$selected_inventory" || fail 'removing nested custom files did not restore inventory bytes'
pass 'only exact generated skill leaves are identity-discounted; nested custom files still count'

selected_source="$TMP/selected/src/hooks/usePaginatedAccumulator.ts"
cp "$selected_source" "$TMP/selected-source.initial"
printf 'export const changed = true;\n' >> "$selected_source"
index_selected "$TMP/selected" > "$TMP/selected-source-change.out"
changed_inventory_hash="$(shasum -a 256 "$selected_inventory" | awk '{print $1}')"
[[ "$changed_inventory_hash" != "$selected_initial_hash" ]] || fail 'selected source mutation did not move inventory identity'
mv "$TMP/selected-source.initial" "$selected_source"
index_selected "$TMP/selected" > "$TMP/selected-source-restore.out"
cmp -s "$TMP/selected-inventory.initial" "$selected_inventory" || fail 'restored source did not restore inventory bytes'
pass 'selected-source mutation moves inventory identity and restoring bytes restores it'

mkdir -p "$TMP/selected/ai_rules/rules"
printf '# Additional human project instruction\nKeep this policy visible.\n' > "$TMP/selected/ai_rules/rules/custom-note.md"
index_selected "$TMP/selected" > "$TMP/selected-custom-instruction.out"
custom_instruction_hash="$(shasum -a 256 "$selected_inventory" | awk '{print $1}')"
[[ "$custom_instruction_hash" != "$selected_initial_hash" ]] || fail 'non-generated custom instruction did not move inventory identity'
python3 - "$selected_inventory" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
assert "ai_rules/rules/custom-note.md" in {row["path"] for row in data["rule_files"]}
print("Custom instruction remains inventoried and changes identity.")
PY
pass 'non-generated custom project instructions still affect inventory identity'

expect_rejection() {
  if "$@" > "$TMP/expected-failure.out" 2>&1; then
    return 1
  fi
  return 0
}
if expect_rejection bash -c 'exit 0'; then
  fail 'negative helper accepted a successful child process'
fi
pass 'negative helper positive-control rejects a successful child process'

reject_source() {
  local label="$1"
  shift
  local before after output="$TMP/reject-$label.out"
  before="$(shasum -a 256 "$selected_inventory" | awk '{print $1}')"
  if bash "$INDEX" "$TMP/selected" "$@" > "$output" 2>&1; then
    fail "$label selection unexpectedly succeeded"
  fi
  after="$(shasum -a 256 "$selected_inventory" | awk '{print $1}')"
  [[ "$after" == "$before" ]] || fail "$label selection changed the prior inventory"
  printf 'Rejected %s: ' "$label"
  sed -n '1p' "$output"
}

mkdir -p "$TMP/selected/src/secrets"
printf 'private credential fixture\n' > "$TMP/selected/src/secrets/credential.ts"
printf '{"not":"source"}\n' > "$TMP/selected/src/unsupported.json"
printf 'outside source fixture\n' > "$TMP/outside-selected.ts"
ln -s "$TMP/outside-selected.ts" "$TMP/selected/src/linked.ts"
ln -s "$TMP/missing-outside.ts" "$TMP/selected/src/dangling.ts"
printf 'unreadable source fixture\n' > "$TMP/selected/src/unreadable.ts"
chmod 000 "$TMP/selected/src/unreadable.ts"
dd if=/dev/zero of="$TMP/selected/src/too-large.ts" bs=131073 count=1 2>/dev/null
printf 'export const extra = true;\n' > "$TMP/selected/src/extra.ts"
reject_source missing --source src/missing.ts
reject_source directory --source src/
reject_source private --source src/secrets/credential.ts
reject_source outside-parent --source ../outside-selected.ts
reject_source outside-absolute --source "$TMP/outside-selected.ts"
reject_source symlink --source src/linked.ts
reject_source dangling-symlink --source src/dangling.ts
reject_source unsupported-suffix --source src/unsupported.json
reject_source unreadable --source src/unreadable.ts
chmod 600 "$TMP/selected/src/unreadable.ts"
reject_source over-read-limit --source src/too-large.ts
reject_source duplicate --source "${SELECTED_SOURCES[0]}" --source "${SELECTED_SOURCES[0]}"
reject_source excessive --source "${SELECTED_SOURCES[0]}" --source "${SELECTED_SOURCES[1]}" \
  --source "${SELECTED_SOURCES[2]}" --source "${SELECTED_SOURCES[3]}" \
  --source "${SELECTED_SOURCES[4]}" --source src/extra.ts
reject_source missing-argument --source
pass 'unsafe, absent, private, non-regular, unsupported, unreadable and excessive selections fail without changing prior inventory'

mkdir -p "$TMP/first-invalid/ai_rules"
printf '{"name":"invalid-first-run-fixture"}\n' > "$TMP/first-invalid/package.json"
printf '# custom map stays as supplied\n' > "$TMP/first-invalid/ai_rules/context_map.md"
first_invalid_map_hash="$(shasum -a 256 "$TMP/first-invalid/ai_rules/context_map.md" | awk '{print $1}')"
if bash "$INDEX" "$TMP/first-invalid" --source src/not-present.ts > "$TMP/first-invalid.out" 2>&1; then
  fail 'invalid first-run selection unexpectedly succeeded'
fi
[[ ! -e "$TMP/first-invalid/ai_rules/project_inventory.json" ]] || fail 'invalid first-run selection wrote a misleading inventory'
[[ "$(shasum -a 256 "$TMP/first-invalid/ai_rules/context_map.md" | awk '{print $1}')" == "$first_invalid_map_hash" ]] || fail 'invalid first-run selection changed the custom map'
pass 'invalid first-run selection writes no inventory and preserves the custom map'

# Explicit bytes are reserved before defaults are sampled, even when the
# explicitly selected package sorts after packages that fill the remaining cap.
mkdir -p "$TMP/budget/src" "$TMP/budget/apps/a/src" "$TMP/budget/apps/b/src" \
  "$TMP/budget/z/selected/src" "$TMP/budget/ai_rules"
printf '{"name":"budget-root"}\n' > "$TMP/budget/package.json"
printf '{"name":"budget-a"}\n' > "$TMP/budget/apps/a/package.json"
printf '{"name":"budget-b"}\n' > "$TMP/budget/apps/b/package.json"
printf '{"name":"budget-selected"}\n' > "$TMP/budget/z/selected/package.json"
printf '# custom map\n' > "$TMP/budget/ai_rules/context_map.md"
python3 - "$TMP/budget" <<'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
for directory, prefix in ((root / "src", "root"), (root / "apps/a/src", "a"), (root / "apps/b/src", "b")):
    for index in range(5):
        (directory / f"{prefix}{index}.ts").write_bytes((prefix + str(index) + "\n").encode().ljust(131072, b"x"))
(root / "z/selected/src/chosen.ts").write_bytes(b"chosen\n".ljust(131072, b"x"))
PY
bash "$INDEX" "$TMP/budget" --source z/selected/src/chosen.ts > "$TMP/budget.out"
python3 - "$TMP/budget/ai_rules/project_inventory.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
selected = next(package for package in data["packages"] if package["path"] == "z/selected")["representative_sources"]
assert [row["path"] for row in selected] == ["z/selected/src/chosen.ts"], selected
assert selected[0]["read_status"] == "read"
total = sum(row["bytes"] for package in data["packages"] for row in package["representative_sources"])
assert total == 2 * 1024 * 1024, total
assert not any(row["path"] == "z/selected/src/chosen.ts" for row in data["exclusions"])
print(f"Later-package explicit source survives a full {total}-byte aggregate sample budget.")
PY
pass 'explicit source rows survive default packages filling the remaining sample budget'

before_mixed="$(source_hashes "$TMP/mixed")"
before_expo="$(source_hashes "$TMP/expo")"
before_python="$(source_hashes "$TMP/python")"
before_library="$(source_hashes "$TMP/library")"
custom_map_hash="$(shasum -a 256 "$TMP/mixed/ai_rules/context_map.md")"
outside_hash="$(shasum -a 256 "$TMP/outside-sentinel.txt")"

bash "$INDEX" "$TMP/expo" > "$TMP/expo.out"
bash "$INDEX" "$TMP/python" > "$TMP/python.out"
bash "$INDEX" "$TMP/library" > "$TMP/library.out"
bash "$INDEX" "$TMP/mixed" > "$TMP/mixed.out"

grep -Fq 'expo' "$TMP/expo/ai_rules/context_map.md" || fail 'Expo dependency missing from Expo inventory'
grep -Fq 'src/App.tsx' "$TMP/expo/ai_rules/context_map.md" || fail 'Expo source path missing'
! grep -Fq 'fastapi' "$TMP/expo/ai_rules/context_map.md" || fail 'Python dependency leaked into Expo inventory'
grep -Fq 'fastapi' "$TMP/python/ai_rules/context_map.md" || fail 'Python dependency missing from Python inventory'
grep -Fq 'src/main.py' "$TMP/python/ai_rules/context_map.md" || fail 'Python source path missing'
! grep -Fq 'react-native' "$TMP/python/ai_rules/context_map.md" || fail 'mobile dependency leaked into Python inventory'
grep -Fq 'zod' "$TMP/library/ai_rules/context_map.md" || fail 'TS library dependency missing'
grep -Fq 'src/index.ts' "$TMP/library/ai_rules/context_map.md" || fail 'TS library entrypoint missing'
python3 - "$TMP/expo/ai_rules/context_map.md" "$TMP/python/ai_rules/context_map.md" "$TMP/library/ai_rules/context_map.md" <<'PY'
import re, sys
for label, path in zip(("Expo", "Python", "TypeScript"), sys.argv[1:]):
    text = open(path, encoding="utf-8").read()
    packages = re.findall(r"^### `([^`]+)`$", text, re.M)
    section = text.split("## Excluded paths and limitations\n", 1)[1]
    exclusions = re.findall(r"^- `([^`]+)` —", section, re.M)
    assert packages == ["."], (label, packages)
    assert exclusions == [], (label, exclusions)
    print(f"{label} fixture: packages={packages}; exclusions={exclusions}")
PY
pass 'Expo, Python, and TypeScript fixtures have separate manifest and source inventories'

python3 - "$TMP/mixed/ai_rules/project_inventory.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
packages = {package["path"]: package for package in data["packages"]}
expected = {".", "apps/mobile", "apps/broken", "packages/core", "services/api", "examples/java"}
assert set(packages) == expected, (set(packages), expected)
assert "expo" in packages["apps/mobile"]["dependencies"]
assert "fastapi" in packages["services/api"]["dependencies"]
assert "zod" in packages["packages/core"]["dependencies"]
assert "services/api/RULES.md" in packages["services/api"]["applicable_instructions"]
assert packages["examples/java"]["manifests"][0]["status"] == "unsupported"
assert packages["apps/broken"]["manifests"][0]["status"] == "unsupported"
assert {item["pattern"] for item in data["workspace_declarations"]} == {"apps/*", "packages/*"}
excluded = {item["path"] for item in data["exclusions"]}
assert "linked-package" in excluded, excluded
assert "apps/escaped/package.json" in excluded, excluded
assert "apps/mobile/.env.local" in excluded, excluded
assert "datasets.csv" in excluded, excluded
assert "dist" in excluded, excluded
assert "vendor" in excluded or "vendor/nested" in excluded, excluded
assert "examples/nestedrepo" in excluded, excluded
serialized = json.dumps(data)
for forbidden in ("outside-symlink-must-not-be-read", "must-not-inventory-nested-repo", "fixture-env-sentinel", "private,data"):
    assert forbidden not in serialized, forbidden
for required in ("apps/mobile/src/App.tsx", "packages/core/src/index.ts", "services/api/src/main.py"):
    assert required in serialized, required
print(f"Mixed fixture packages: {sorted(packages)}")
print(f"Mixed fixture exclusions: {sorted(excluded)}")
PY
pass 'mixed packages, applicable instructions, unsupported manifests, and exclusions are enumerated'

[[ "$(shasum -a 256 "$TMP/mixed/ai_rules/context_map.md")" == "$custom_map_hash" ]] || fail 'custom map changed'
[[ "$(shasum -a 256 "$TMP/outside-sentinel.txt")" == "$outside_hash" ]] || fail 'outside sentinel changed'
[[ "$(source_hashes "$TMP/mixed")" == "$before_mixed" ]] || fail 'fixture source, manifest, or instruction bytes changed'
[[ "$(source_hashes "$TMP/expo")" == "$before_expo" ]] || fail 'Expo fixture source or manifest bytes changed'
[[ "$(source_hashes "$TMP/python")" == "$before_python" ]] || fail 'Python fixture source or manifest bytes changed'
[[ "$(source_hashes "$TMP/library")" == "$before_library" ]] || fail 'TS fixture source or manifest bytes changed'
[[ -L "$TMP/mixed/linked-package" ]] || fail 'package symlink changed'
[[ -z "$(find "$TMP" -name README.inventory.md -print -quit)" ]] || fail 'inventory wrote README.inventory.md into a product source tree'
pass 'custom map, all fixture source hashes, symlink, outside sentinel, and source-tree paths are preserved'

mkdir -p "$TMP/mixed/services/worker/src"
cat > "$TMP/mixed/services/worker/pyproject.toml" <<'TOML'
[project]
name = "worker-fixture"
dependencies = ["celery"]
TOML
cat > "$TMP/mixed/services/worker/src/main.py" <<'PY'
def run():
    return None
PY
bash "$INDEX" "$TMP/mixed" > "$TMP/mixed-second.out"
python3 - "$TMP/mixed/ai_rules/project_inventory.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
package_paths = sorted(package["path"] for package in data["packages"])
assert "services/worker" in package_paths
print(f"Mixed live-rescan packages: {package_paths}")
PY
[[ "$(shasum -a 256 "$TMP/mixed/ai_rules/context_map.md")" == "$custom_map_hash" ]] || fail 'custom map changed on refresh'
pass 'a newly added package appears on the next scan'

printf '\nuser customization\n' >> "$TMP/mixed/ai_rules/project_inventory.json"
custom_inventory_hash="$(shasum -a 256 "$TMP/mixed/ai_rules/project_inventory.json")"
if bash "$INDEX" "$TMP/mixed" > "$TMP/conflict.out" 2>&1; then
  fail 'modified companion inventory was overwritten'
fi
[[ "$(shasum -a 256 "$TMP/mixed/ai_rules/project_inventory.json")" == "$custom_inventory_hash" ]] || fail 'customized companion inventory changed after conflict'
pass 'modified companion inventory fails closed without overwriting user bytes'

mkdir -p "$TMP/map-link/ai_rules"
printf '# external custom map\n' > "$TMP/external-map.md"
ln -s "$TMP/external-map.md" "$TMP/map-link/ai_rules/context_map.md"
link_target="$(readlink "$TMP/map-link/ai_rules/context_map.md")"
external_map_hash="$(shasum -a 256 "$TMP/external-map.md")"
bash "$INDEX" "$TMP/map-link" > "$TMP/map-link.out"
[[ -L "$TMP/map-link/ai_rules/context_map.md" ]] || fail 'context-map symlink was replaced'
[[ "$(readlink "$TMP/map-link/ai_rules/context_map.md")" == "$link_target" ]] || fail 'context-map symlink target changed'
[[ "$(shasum -a 256 "$TMP/external-map.md")" == "$external_map_hash" ]] || fail 'symlink target bytes changed'
[[ -f "$TMP/map-link/ai_rules/project_inventory.json" ]] || fail 'symlink map did not route to companion inventory'
pass 'map symlink remains intact and inventory stays inside the selected root'

mkdir -p "$TMP/external-rules" "$TMP/root-with-linked-rules"
printf 'outside sentinel\n' > "$TMP/external-rules/keep.txt"
external_files="$(find "$TMP/external-rules" -type f -print | sort)"
ln -s "$TMP/external-rules" "$TMP/root-with-linked-rules/ai_rules"
if bash "$INDEX" "$TMP/root-with-linked-rules" > "$TMP/linked-rules.out" 2>&1; then
  fail 'symlinked ai_rules destination was accepted'
fi
[[ -L "$TMP/root-with-linked-rules/ai_rules" ]] || fail 'ai_rules symlink was replaced'
[[ "$(find "$TMP/external-rules" -type f -print | sort)" == "$external_files" ]] || fail 'ai_rules symlink caused an outside write'
pass 'symlinked output directory fails closed before writing outside the root'

printf 'All index fixtures passed.\n'
