#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
INDEX="$ROOT/bin/sh-index.sh"
PORTABLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib/portable.sh"
# shellcheck source=lib/portable.sh
. "$PORTABLE"
require_tools bash cmp
require_python311
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
mkdir -p "$TMP/mixed/services/shop/Model" "$TMP/mixed/services/brokenphp"
cat > "$TMP/mixed/services/shop/composer.json" <<'JSON'
{"name":"Acme/Module-Shop","require":{"php":"~8.2.0","ext-json":"*","symfony/framework-bundle":"7.1.*","Laravel/Framework":"^11","x/(unsupported)":"*","acme/object-value":{"v":1}},"require-dev":{"phpunit/phpunit":"^10"},"scripts":{"test":"phpunit","check":["@test","phpcs"],"bad":{"x":1}}}
JSON
cat > "$TMP/mixed/services/shop/Model/Cart.php" <<'PHP'
<?php
class Cart {}
PHP
printf '{ malformed composer\n' > "$TMP/mixed/services/brokenphp/composer.json"
mkdir -p "$TMP/mixed/services/arrayphp"
printf '[1,2]\n' > "$TMP/mixed/services/arrayphp/composer.json"
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
# The baseline was re-pinned once: project_root_name is now "." instead of the folder name (2026-10-09).
# It was re-pinned again for scan.source_head (2026-10-26): this fixture is not a git repository, so the key is null.
mkdir -p "$TMP/selected/src/features/pagination" "$TMP/selected/ai_rules"
printf '{"name":"selected-source-fixture"}\n' > "$TMP/selected/package.json"
for letter in a b c d e; do
  printf 'export const %s = true;\n' "$letter" > "$TMP/selected/src/$letter.ts"
done
printf 'export const useHomePostList = true;\n' > "$TMP/selected/src/features/pagination/useHomePostList.ts"
printf '# custom context map\n' > "$TMP/selected/ai_rules/context_map.md"
bash "$INDEX" "$TMP/selected" > "$TMP/default.out"
[[ "$(sha256_file "$TMP/selected/ai_rules/project_inventory.json")" == "ef327daba222a0bc76bf19da9e6bbb5322ae7cffab14354045e2d33872c8fbce" ]] || fail 'default index output differs from pinned byte baseline'
python3 -I -B - "$TMP/selected/ai_rules/project_inventory.json" <<'PY'
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
python3 -I -B - "$TMP/selected/ai_rules/project_inventory.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
sources = [row["path"] for row in data["packages"][0]["representative_sources"]]
assert sources == ["src/components/indexes/index.ts", "src/hooks/usePaginatedAccumulator.ts", "src/store/api/baseApi.ts", "src/store/api/groupsApi.ts", "src/components/organisms/posts/ListComponent.tsx"], sources
assert "src/components/templates/HomePostListComponent/useHomePostList.ts" not in sources
print(f"Default source sample remains bounded: {sources}")
PY
index_selected "$TMP/selected" > "$TMP/selected-explicit.out"
python3 -I -B - "$TMP/selected" "${SELECTED_SOURCES[@]}" <<'PY'
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
    | sort -z | xargs -0 bash -c '. "$0"; sha256_lines "$@"' "$PORTABLE"
}

selected_inventory="$TMP/selected/ai_rules/project_inventory.json"
selected_initial_hash="$(sha256_file "$selected_inventory")"
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
custom_skill_hash="$(sha256_file "$selected_inventory")"
[[ "$custom_skill_hash" != "$selected_initial_hash" ]] || fail 'custom files below generated skill leaves did not move inventory identity'
python3 -I -B - "$TMP/selected-inventory.initial" "$selected_inventory" <<'PY'
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
changed_inventory_hash="$(sha256_file "$selected_inventory")"
[[ "$changed_inventory_hash" != "$selected_initial_hash" ]] || fail 'selected source mutation did not move inventory identity'
mv "$TMP/selected-source.initial" "$selected_source"
index_selected "$TMP/selected" > "$TMP/selected-source-restore.out"
cmp -s "$TMP/selected-inventory.initial" "$selected_inventory" || fail 'restored source did not restore inventory bytes'
pass 'selected-source mutation moves inventory identity and restoring bytes restores it'

mkdir -p "$TMP/selected/ai_rules/rules"
printf '# Additional human project instruction\nKeep this policy visible.\n' > "$TMP/selected/ai_rules/rules/custom-note.md"
index_selected "$TMP/selected" > "$TMP/selected-custom-instruction.out"
custom_instruction_hash="$(sha256_file "$selected_inventory")"
[[ "$custom_instruction_hash" != "$selected_initial_hash" ]] || fail 'non-generated custom instruction did not move inventory identity'
python3 -I -B - "$selected_inventory" <<'PY'
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
  before="$(sha256_file "$selected_inventory")"
  if bash "$INDEX" "$TMP/selected" "$@" > "$output" 2>&1; then
    fail "$label selection unexpectedly succeeded"
  fi
  after="$(sha256_file "$selected_inventory")"
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
first_invalid_map_hash="$(sha256_file "$TMP/first-invalid/ai_rules/context_map.md")"
if bash "$INDEX" "$TMP/first-invalid" --source src/not-present.ts > "$TMP/first-invalid.out" 2>&1; then
  fail 'invalid first-run selection unexpectedly succeeded'
fi
[[ ! -e "$TMP/first-invalid/ai_rules/project_inventory.json" ]] || fail 'invalid first-run selection wrote a misleading inventory'
[[ "$(sha256_file "$TMP/first-invalid/ai_rules/context_map.md")" == "$first_invalid_map_hash" ]] || fail 'invalid first-run selection changed the custom map'
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
python3 -I -B - "$TMP/budget" <<'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
for directory, prefix in ((root / "src", "root"), (root / "apps/a/src", "a"), (root / "apps/b/src", "b")):
    for index in range(5):
        (directory / f"{prefix}{index}.ts").write_bytes((prefix + str(index) + "\n").encode().ljust(131072, b"x"))
(root / "z/selected/src/chosen.ts").write_bytes(b"chosen\n".ljust(131072, b"x"))
PY
bash "$INDEX" "$TMP/budget" --source z/selected/src/chosen.ts > "$TMP/budget.out"
python3 -I -B - "$TMP/budget/ai_rules/project_inventory.json" <<'PY'
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
custom_map_hash="$(sha256_lines "$TMP/mixed/ai_rules/context_map.md")"
outside_hash="$(sha256_lines "$TMP/outside-sentinel.txt")"

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
python3 -I -B - "$TMP/expo/ai_rules/context_map.md" "$TMP/python/ai_rules/context_map.md" "$TMP/library/ai_rules/context_map.md" <<'PY'
import re, sys
for label, path in zip(("Expo", "Python", "TypeScript"), sys.argv[1:]):
    text = open(path, encoding="utf-8").read()
    packages = re.findall(r"^### `([^`]+)`$", text, re.M)
    section = text.split("## Excluded paths and limitations\n", 1)[1]
    exclusions = re.findall(r"^- `([^`]+)`: ", section, re.M)
    assert packages == ["."], (label, packages)
    assert exclusions == [], (label, exclusions)
    print(f"{label} fixture: packages={packages}; exclusions={exclusions}")
PY
pass 'Expo, Python, and TypeScript fixtures have separate manifest and source inventories'

python3 -I -B - "$TMP/mixed/ai_rules/project_inventory.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
packages = {package["path"]: package for package in data["packages"]}
expected = {".", "apps/mobile", "apps/broken", "packages/core", "services/api", "services/shop", "services/brokenphp", "services/arrayphp", "examples/java"}
assert set(packages) == expected, (set(packages), expected)
assert "expo" in packages["apps/mobile"]["dependencies"]
assert "fastapi" in packages["services/api"]["dependencies"]
assert "zod" in packages["packages/core"]["dependencies"]
assert "services/api/RULES.md" in packages["services/api"]["applicable_instructions"]
assert packages["examples/java"]["manifests"][0]["status"] == "unsupported"
assert packages["apps/broken"]["manifests"][0]["status"] == "unsupported"
shop = packages["services/shop"]
assert shop["manifests"][0]["status"] == "supported", shop["manifests"]
assert shop["names"] == ["acme/module-shop"], shop["names"]
assert shop["dependencies"] == ["laravel/framework", "phpunit/phpunit", "symfony/framework-bundle"], shop["dependencies"]
assert shop["scripts"] == ["check", "test"], shop["scripts"]
assert shop["stack_signals"] == ["laravel/framework", "symfony/framework-bundle"], shop["stack_signals"]
assert "services/shop/Model/Cart.php" in {item["path"] for item in shop["representative_sources"]}
assert packages["services/brokenphp"]["manifests"][0]["status"] == "unsupported"
assert packages["services/arrayphp"]["manifests"][0]["status"] == "unsupported"
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

mkdir -p "$TMP/phponly/Model"
printf '{"name":"acme/php-only","require":{"php":"^8.2"}}\n' > "$TMP/phponly/composer.json"
printf '<?php\nclass Thing {}\n' > "$TMP/phponly/Model/Thing.php"
bash "$INDEX" "$TMP/phponly" > /dev/null
grep -Fq '`composer.json` (supported)' "$TMP/phponly/ai_rules/context_map.md" || fail 'composer.json not shown as supported in a PHP-only map'
! grep -Fq '(unsupported)' "$TMP/phponly/ai_rules/context_map.md" || fail 'PHP-only map still reports an unsupported manifest'
pass 'a PHP-only project map reports its composer.json as supported'

mkdir -p "$TMP/phpredos/Model"
python3 -I -B -c 'import json; print(json.dumps({"name": "a" * 4000 + "!", "require": {"a" * 4000 + "!": "*", "a/" + "a" * 4000 + "!": "*"}}))' > "$TMP/phpredos/composer.json"
printf '<?php\nclass Thing {}\n' > "$TMP/phpredos/Model/Thing.php"
# Own process group, killed whole on timeout, so a regression cannot leave index running.
python3 -I -B - "$INDEX" "$TMP/phpredos" <<'PY' || fail 'a long near-match composer name made index slow (regex backtracking) or fail'
import os, signal, subprocess, sys
child = subprocess.Popen(["bash", sys.argv[1], sys.argv[2]], stdout=subprocess.DEVNULL, start_new_session=True)
try:
    sys.exit(child.wait(timeout=20))
except subprocess.TimeoutExpired:
    os.killpg(child.pid, signal.SIGKILL)
    sys.exit(1)
PY
grep -Fq 'Declared names: none parsed' "$TMP/phpredos/ai_rules/context_map.md" || fail 'an invalid composer name was kept'
pass 'a long near-match composer name is refused quickly'

# Hostile manifest values: a name that would forge a package heading, a lone surrogate, and nesting deep
# enough to exhaust the TOML parser (RecursionError). index must finish, drop the values and keep the map well formed.
mkdir -p "$TMP/hostile/apps/inject/src" "$TMP/hostile/apps/surrogate/src" "$TMP/hostile/apps/deep/src" "$TMP/hostile/apps/uvbad/src"
printf '[project]\nname = "uvbad"\ndependencies = ["fastapi>=1"]\n[tool]\nuv = "not-a-table"\n' > "$TMP/hostile/apps/uvbad/pyproject.toml"
printf '{"name":"root-fixture","private":true,"workspaces":["apps/*"]}\n' > "$TMP/hostile/package.json"
printf '{"name":"evil\\n### `forged`","scripts":{"ok":"x","bad`name":"y","line\\nbreak":"z"},"dependencies":{"left-pad":"*","dep\\nx":"*"}}\n' > "$TMP/hostile/apps/inject/package.json"
printf '{"name":"\\ud800","dependencies":{"\\udfff":"*","right-pad":"*","sep\\u2028x":"*","rtl\\u202ex":"*","nel\\u0085x":"*"}}\n' > "$TMP/hostile/apps/surrogate/package.json"
python3 -I -B -c 'import sys; open(sys.argv[1], "w").write("[project]\nname = \"deep\"\ndependencies = " + "[" * 5000 + "]" * 5000 + "\n")' "$TMP/hostile/apps/deep/pyproject.toml"
for app in inject surrogate deep uvbad; do printf 'export const x = 1;\n' > "$TMP/hostile/apps/$app/src/index.ts"; done
bash "$INDEX" "$TMP/hostile" > "$TMP/hostile.out" 2>&1 || fail "index crashed on hostile manifest values: $(tail -3 "$TMP/hostile.out")"
python3 -I -B - "$TMP/hostile/ai_rules/context_map.md" <<'PY' || fail 'hostile manifest values reached the map'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
headings = re.findall(r"^### `([^`]+)`$", text, re.M)
assert headings == [".", "apps/deep", "apps/inject", "apps/surrogate", "apps/uvbad"], headings
assert "forged" not in text and "bad`name" not in text and "line\nbreak" not in text, "an unsafe value was kept"
assert not any(ch in text for ch in "\u2028\u202e\x85"), "a line separator or direction override was kept"
assert "`fastapi`" in text, "a pyproject with a malformed [tool.uv] still reports its dependencies"
assert "`left-pad`" in text and "`right-pad`" in text and "`ok`" in text, "safe values next to unsafe ones were lost"
assert re.search(r"`apps/deep/pyproject.toml` \(unsupported\)", text), "a parser-exhausting manifest must be recorded as unsupported"
PY
pass 'hostile manifest names, surrogates and deep nesting are dropped without crashing index'

[[ "$(sha256_lines "$TMP/mixed/ai_rules/context_map.md")" == "$custom_map_hash" ]] || fail 'custom map changed'
[[ "$(sha256_lines "$TMP/outside-sentinel.txt")" == "$outside_hash" ]] || fail 'outside sentinel changed'
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
python3 -I -B - "$TMP/mixed/ai_rules/project_inventory.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
package_paths = sorted(package["path"] for package in data["packages"])
assert "services/worker" in package_paths
print(f"Mixed live-rescan packages: {package_paths}")
PY
[[ "$(sha256_lines "$TMP/mixed/ai_rules/context_map.md")" == "$custom_map_hash" ]] || fail 'custom map changed on refresh'
pass 'a newly added package appears on the next scan'

printf '\nuser customization\n' >> "$TMP/mixed/ai_rules/project_inventory.json"
custom_inventory_hash="$(sha256_lines "$TMP/mixed/ai_rules/project_inventory.json")"
if bash "$INDEX" "$TMP/mixed" > "$TMP/conflict.out" 2>&1; then
  fail 'modified companion inventory was overwritten'
fi
[[ "$(sha256_lines "$TMP/mixed/ai_rules/project_inventory.json")" == "$custom_inventory_hash" ]] || fail 'customized companion inventory changed after conflict'
pass 'modified companion inventory fails closed without overwriting user bytes'

mkdir -p "$TMP/map-link/ai_rules"
printf '# external custom map\n' > "$TMP/external-map.md"
ln -s "$TMP/external-map.md" "$TMP/map-link/ai_rules/context_map.md"
link_target="$(readlink "$TMP/map-link/ai_rules/context_map.md")"
external_map_hash="$(sha256_lines "$TMP/external-map.md")"
bash "$INDEX" "$TMP/map-link" > "$TMP/map-link.out"
[[ -L "$TMP/map-link/ai_rules/context_map.md" ]] || fail 'context-map symlink was replaced'
[[ "$(readlink "$TMP/map-link/ai_rules/context_map.md")" == "$link_target" ]] || fail 'context-map symlink target changed'
[[ "$(sha256_lines "$TMP/external-map.md")" == "$external_map_hash" ]] || fail 'symlink target bytes changed'
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

mkdir -p "$TMP/name-a/clone-alpha/src" "$TMP/name-b/other-name/src"
for clone in "$TMP/name-a/clone-alpha" "$TMP/name-b/other-name"; do
  printf '{"name":"same-content","dependencies":{"react":"18.3.1"}}\n' > "$clone/package.json"
  printf 'export const same = 1;\n' > "$clone/src/index.ts"
  bash "$INDEX" "$clone" > "$clone.out" 2>&1
done
diff -r "$TMP/name-a/clone-alpha/ai_rules" "$TMP/name-b/other-name/ai_rules" > "$TMP/name-diff.out" || fail 'index output depends on the checkout folder name'
pass 'same content under two folder names produces byte-identical index output'

mkdir -p "$TMP/overcap/src" "$TMP/overcap/ai_rules"
printf '{"name":"overcap-fixture"}\n' > "$TMP/overcap/package.json"
printf 'export const small = 1;\n' > "$TMP/overcap/src/small.js"
python3 -I -B -c 'import sys; open(sys.argv[1], "wb").write(b"// big\n".ljust(180000, b"x"))' "$TMP/overcap/src/big.js"
bash "$INDEX" "$TMP/overcap" > "$TMP/overcap.out"
overcap_map="$TMP/overcap/ai_rules/context_map.md"
overcap_rep="$(grep -F -- '- Representative first-party source:' "$overcap_map" || true)"
[[ -n "$overcap_rep" ]] || fail 'representative source line missing from over-cap map'
grep -Fq 'small.js' <<<"$overcap_rep" || fail 'readable source missing from representative list'
! grep -Fq 'big.js' <<<"$overcap_rep" || fail 'over-cap source listed as representative (read) source'
grep -Fq -- '- `src/big.js`: source not sampled:' "$overcap_map" || fail 'over-cap source missing from excluded section'
pass 'over-cap source is excluded, not listed as representative'

# A scan that stops at a read limit says so on stdout; a complete scan does not.
mkdir -p "$TMP/wide"
printf '{"name":"wide-fixture"}\n' > "$TMP/wide/package.json"
python3 -I -B -c 'import os, sys; [os.makedirs(os.path.join(sys.argv[1], "d%05d" % i)) for i in range(5100)]' "$TMP/wide"
bash "$INDEX" "$TMP/wide" > "$TMP/wide.out"
grep -Eq '^INCOMPLETE: .*--exclude-dir' "$TMP/wide.out" || fail 'truncated scan prints an INCOMPLETE line naming --exclude-dir'
grep -Fq 'read limit (directory limit 5000;' "$TMP/wide.out" || fail 'INCOMPLETE line names the directory limit that stopped the scan'
! grep -Fq 'file limit' "$TMP/wide.out" || fail 'directory-limit INCOMPLETE line does not name the file limit'
! grep -Eq '^INCOMPLETE:' "$TMP/expo.out" || fail 'a complete scan prints no INCOMPLETE line'
pass 'a truncated scan prints INCOMPLETE with --exclude-dir; a complete scan does not'

# The file limit is its own branch and names itself.
mkdir -p "$TMP/manyfiles"
printf '{"name":"manyfiles-fixture"}\n' > "$TMP/manyfiles/package.json"
python3 -I -B -c 'import os, sys
for i in range(25_100):
    open(os.path.join(sys.argv[1], "f%05d.txt" % i), "w").close()' "$TMP/manyfiles"
bash "$INDEX" "$TMP/manyfiles" > "$TMP/manyfiles.out"
grep -Eq '^INCOMPLETE: scan stopped at a read limit \(file limit 25000;.*--exclude-dir' "$TMP/manyfiles.out" || fail 'file-limit scan prints an INCOMPLETE line naming the file limit'
! grep -Fq 'directory limit' "$TMP/manyfiles.out" || fail 'file-limit INCOMPLETE line does not name the directory limit'
pass 'a scan stopped by the file limit prints INCOMPLETE naming the file limit'

# An unreadable directory makes the scan partial without any limit being hit: the wording must say so.
mkdir -p "$TMP/locked/src" "$TMP/locked/secret"
printf '{"name":"locked-fixture"}\n' > "$TMP/locked/package.json"
printf 'export const a = 1;\n' > "$TMP/locked/src/a.js"
chmod 000 "$TMP/locked/secret"
bash "$INDEX" "$TMP/locked" > "$TMP/locked.out" 2>&1 || { chmod 755 "$TMP/locked/secret"; fail 'index with an unreadable directory exits 0'; }
chmod 755 "$TMP/locked/secret"
if [[ "$(id -u)" != 0 ]]; then
  grep -Eq '^INCOMPLETE: some paths could not be read; the inventory is partial\.' "$TMP/locked.out" || fail 'unreadable directory prints the unreadable INCOMPLETE wording'
  ! grep -Fq 'read limit' "$TMP/locked.out" || fail 'unreadable directory does not claim a read limit'
  pass 'an unreadable directory prints the unreadable wording, not the read-limit wording'
else
  printf 'SKIP: unreadable-directory check needs a non-root user (root reads every directory)\n'
fi

# A refresh keeps its scope: explicit sources are recorded, --same-scope reads them and the exclusions back,
# and a plain refresh that drops either says so on stderr.
make_scope_fixture() {
  mkdir -p "$1/src" "$1/gen"
  printf '{"name":"scope-fixture"}\n' > "$1/package.json"
  for name in a b c d e f g; do printf 'export const %s = 1;\n' "$name" > "$1/src/$name.js"; done
  printf 'export const generated = 1;\n' > "$1/gen/out.js"
}
make_scope_fixture "$TMP/scope"
bash "$INDEX" "$TMP/scope" --source src/g.js --exclude-dir gen > /dev/null || fail 'index with --source and --exclude-dir exits 0'
grep -Fq -- '- Explicit representative sources: `src/g.js`; repeat --source options on refresh, or run index with --same-scope.' "$TMP/scope/ai_rules/context_map.md" || fail 'the map records the explicit sources'
bash "$INDEX" "$TMP/scope" --same-scope --preview > "$TMP/scope-same.out" 2> "$TMP/scope-same.err" || fail '--same-scope --preview exits 0'
bash "$INDEX" "$TMP/scope" --source src/g.js --exclude-dir gen --preview > "$TMP/scope-explicit.out" || fail 'a preview with the original options exits 0'
cmp -s "$TMP/scope-same.out" "$TMP/scope-explicit.out" || fail '--same-scope gives the same bytes as repeating the original options'
! grep -Fq 'SCOPE:' "$TMP/scope-same.err" || fail '--same-scope with a full record prints no SCOPE line'
bash "$INDEX" "$TMP/scope" --preview > "$TMP/scope-plain.out" 2> "$TMP/scope-plain.err" || fail 'a plain refresh preview still exits 0'
grep -Fq 'SCOPE:' "$TMP/scope-plain.err" && grep -Fq '`gen`' "$TMP/scope-plain.err" && grep -Fq '`src/g.js`' "$TMP/scope-plain.err" || fail 'a plain refresh names the dropped exclusion and source on stderr'
! grep -Fq 'SCOPE:' "$TMP/scope-plain.out" || fail 'SCOPE lines never enter the preview bytes'
if bash "$INDEX" "$TMP/scope" --same-scope --source src/a.js > /dev/null 2> "$TMP/scope-mixed.err"; then fail '--same-scope with --source is refused'; fi
grep -Fq -- '--same-scope' "$TMP/scope-mixed.err" || fail 'the refusal names --same-scope'
mkdir -p "$TMP/noinv"; printf '{"name":"no-inventory"}\n' > "$TMP/noinv/package.json"
if bash "$INDEX" "$TMP/noinv" --same-scope --preview > /dev/null 2> "$TMP/noinv.err"; then fail '--same-scope with no inventory is refused'; fi
grep -Fq 'no generated inventory' "$TMP/noinv.err" || fail 'the no-inventory refusal says why'
[[ ! -e "$TMP/noinv/ai_rules" ]] || fail 'a refused --same-scope writes nothing'
pass 'Markdown map: explicit sources recorded, --same-scope reproduces it, a plain refresh warns, misuse is refused'

# The JSON inventory (used when context_map.md is customized) records and reuses the same scope.
make_scope_fixture "$TMP/scopejson"
mkdir -p "$TMP/scopejson/ai_rules"; printf '# My own notes\n' > "$TMP/scopejson/ai_rules/context_map.md"
bash "$INDEX" "$TMP/scopejson" --source src/g.js --exclude-dir gen > /dev/null || fail 'JSON index with options exits 0'
python3 -I -B - "$TMP/scopejson/ai_rules/project_inventory.json" <<'PY' || fail 'the JSON inventory records explicit sources in scan'
import json, sys
scan = json.load(open(sys.argv[1]))["scan"]
assert scan["explicit_sources"] == ["src/g.js"], scan
assert scan["excluded_directories"] == ["gen"], scan
PY
bash "$INDEX" "$TMP/scopejson" --same-scope --preview > "$TMP/scopejson-same.out" || fail 'JSON --same-scope --preview exits 0'
bash "$INDEX" "$TMP/scopejson" --source src/g.js --exclude-dir gen --preview > "$TMP/scopejson-explicit.out" || fail 'a JSON preview with the original options exits 0'
cmp -s "$TMP/scopejson-same.out" "$TMP/scopejson-explicit.out" || fail '--same-scope gives the same JSON bytes as repeating the original options'
# An inventory written before sources were recorded: --same-scope keeps the exclusions and says the sources are unknown;
# a plain refresh notices that the sampled sources changed.
python3 -I -B - "$TMP/scopejson/ai_rules/project_inventory.json" <<'PY'
import hashlib, json, sys
path = sys.argv[1]
value = json.load(open(path))
value.pop("integrity")
del value["scan"]["explicit_sources"]
value["limitations"] = [line for line in value["limitations"] if not line.startswith("Explicit representative sources:")]
canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
value["integrity"] = {"sha256": hashlib.sha256(canonical).hexdigest()}
open(path, "w", encoding="utf-8").write(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
PY
bash "$INDEX" "$TMP/scopejson" --same-scope --preview > "$TMP/old-same.out" 2> "$TMP/old-same.err" || fail '--same-scope over an older inventory exits 0'
grep -Fq 'SCOPE:' "$TMP/old-same.err" && grep -Fq 'does not record explicit --source' "$TMP/old-same.err" || fail '--same-scope says an older inventory has no source record'
grep -Fq 'predates source recording' "$TMP/old-same.err" || fail 'the changed-sample line says when it matters'
python3 -I -B - "$TMP/old-same.out" <<'PY' || fail '--same-scope over an older inventory keeps its exclusions'
import json, sys
assert json.load(open(sys.argv[1]))["scan"]["excluded_directories"] == ["gen"]
PY
bash "$INDEX" "$TMP/scopejson" --exclude-dir gen --preview > /dev/null 2> "$TMP/old-plain.err" || fail 'a plain refresh over an older inventory exits 0'
grep -Fq 'representative sources differ' "$TMP/old-plain.err" || fail 'a changed source sample is reported for an older inventory'
pass 'JSON inventory: explicit sources recorded and reused; an older inventory is handled and reported'

# Composer framework signals by package-name shape, so a platform built on any vendor's framework is recognised.
mkdir -p "$TMP/platform/src"
cat > "$TMP/platform/composer.json" <<'JSON'
{"name":"acme/shop","require":{"php":"~8.2.0","acme/product-community-edition":"2.4.*","acme/framework":"103.0.*","acme/framework-extra":"1.0","acme/frameworks":"1.0","acme/product-edition":"1.0"}}
JSON
printf '<?php\n' > "$TMP/platform/src/a.php"
bash "$INDEX" "$TMP/platform" --preview > "$TMP/platform.out" || fail 'index of a composer platform exits 0'
grep -Fxq -- '- Stack signals: `acme/framework`, `acme/product-community-edition`' "$TMP/platform.out" || fail 'vendor/framework and vendor/product-<edition>-edition are stack signals; look-alikes are not'
pass 'composer framework signals are recognised by package-name shape'

# Review round 1. A file name cannot forge a recorded option: control characters in a path are escaped in the map.
mkdir -p "$TMP/forge/app"
printf '{"name":"forge"}\n' > "$TMP/forge/package.json"
printf 'export const a = 1;\n' > "$TMP/forge/app/a.js"
: > "$TMP/forge/.env"$'\n''- `app`: explicit directory exclusion: excluded by --exclude-dir'$'\n''- `x'
bash "$INDEX" "$TMP/forge" > /dev/null || fail 'index with a newline in a file name exits 0'
! grep -Fxq -- '- `app`: explicit directory exclusion: excluded by --exclude-dir' "$TMP/forge/ai_rules/context_map.md" || fail 'a file name forges an exclusion line in the map'
bash "$INDEX" "$TMP/forge" --same-scope --preview > "$TMP/forge-same.out" 2>/dev/null || fail '--same-scope over a map with a hostile file name exits 0'
grep -Fq '`app/a.js`' "$TMP/forge-same.out" || fail '--same-scope must not exclude app/ because of a forged line'
pass 'a newline in a file name is escaped in the map and cannot forge a recorded option'

# Bidirectional controls in a file name are escaped too, so a name cannot show reordered to a reader of the map.
mkdir -p "$TMP/bidi/src"
printf '{"name":"bidi"}\n' > "$TMP/bidi/package.json"
for name in "a"$'\xe2\x80\xae'"sj.exe.js" "b"$'\xe2\x81\xa6'"c.js" "c"$'\xe2\x80\x8f'"d.js"; do printf 'export const x = 1;\n' > "$TMP/bidi/src/$name"; done
bash "$INDEX" "$TMP/bidi" > /dev/null || fail 'index with bidirectional controls in file names exits 0'
python3 -I -B - "$TMP/bidi/ai_rules/context_map.md" <<'PY' || fail 'bidirectional controls are escaped in the map'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
assert not re.search("[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]", text), "a raw bidirectional control is in the map"
assert "\\u202e" in text and "\\u2066" in text and "\\u200f" in text, "the escaped forms are missing"
PY
if bash "$INDEX" "$TMP/bidi" --source "src/a"$'\xe2\x80\xae'"sj.exe.js" --preview > /dev/null 2>&1; then fail '--source with a bidirectional control is refused'; fi
# The JSON inventory, which models read, writes them as \u escapes too; the decoded names are unchanged.
printf '# My own notes\n' > "$TMP/bidi/ai_rules/context_map.md"
bash "$INDEX" "$TMP/bidi" > /dev/null || fail 'JSON index with bidirectional controls in file names exits 0'
python3 -I -B - "$TMP/bidi/ai_rules/project_inventory.json" <<'PY' || fail 'bidirectional controls are escaped in the JSON inventory'
import json, re, sys
raw = open(sys.argv[1], encoding="utf-8").read()
assert not re.search("[\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]", raw), "a raw bidirectional control is in the JSON inventory"
assert "\u202e" in json.dumps(json.loads(raw), ensure_ascii=False), "the decoded inventory lost the file name"
PY
# A path from the synthesis receipt cannot forge a stderr line or show reordered in a refusal.
mkdir -p "$TMP/badreceipt/.claude/agents"
printf '{"name":"receipt"}\n' > "$TMP/badreceipt/package.json"
python3 -I -B -c 'import json, sys; json.dump({"format": "spec-harness-synthesis", "schema_version": 4, "packages": [{"path": ".", "rules_path": "x\u202e\nFORGED: line/RULES.md", "sha256": "0" * 64}]}, open(sys.argv[1], "w"))' "$TMP/badreceipt/.claude/agents/.init-synthesis.json"
if bash "$INDEX" "$TMP/badreceipt" --preview > /dev/null 2> "$TMP/badreceipt.err"; then fail 'a receipt with a rules path outside its package is refused'; fi
grep -Fq 'ownership unavailable' "$TMP/badreceipt.err" || fail 'the receipt refusal says why'
! grep -q '^FORGED' "$TMP/badreceipt.err" || fail 'a receipt path forged a stderr line'
python3 -I -B -c 'import re, sys; sys.exit(1 if re.search("[\u202a-\u202e]", open(sys.argv[1], encoding="utf-8").read()) else 0)' "$TMP/badreceipt.err" || fail 'a receipt path wrote a raw bidirectional control to stderr'
# The two other receipt refusals escape the path as well: an owned output whose folder does not exist (missing), and
# an owned output the scan finds but cannot read (fifo: a FIFO named RULES.md).
for case in missing fifo; do
  mkdir -p "$TMP/badreceipt-$case/.claude/agents"
  printf '{"name":"receipt"}\n' > "$TMP/badreceipt-$case/package.json"
  python3 -I -B -c 'import json, sys; p = "x\u202e\nFORGED: line"; json.dump({"format": "spec-harness-synthesis", "schema_version": 4, "packages": [{"path": p, "rules_path": p + "/RULES.md", "sha256": "0" * 64}]}, open(sys.argv[1], "w"))' "$TMP/badreceipt-$case/.claude/agents/.init-synthesis.json"
done
python3 -I -B -c 'import os, sys; folder = os.path.join(sys.argv[1], "x\u202e\nFORGED: line"); os.mkdir(folder); os.mkfifo(os.path.join(folder, "RULES.md"))' "$TMP/badreceipt-fifo"
for case in missing fifo; do
  if bash "$INDEX" "$TMP/badreceipt-$case" --preview > /dev/null 2> "$TMP/badreceipt-$case.err"; then fail "a receipt whose owned output is $case is refused"; fi
  ! grep -q '^FORGED' "$TMP/badreceipt-$case.err" || fail "a receipt path forged a stderr line ($case output)"
  python3 -I -B -c 'import re, sys; sys.exit(1 if re.search("[\u202a-\u202e]", open(sys.argv[1], encoding="utf-8").read()) else 0)' "$TMP/badreceipt-$case.err" || fail "a receipt path wrote a raw bidirectional control to stderr ($case output)"
done
grep -Fq 'registered generated output is missing, linked or not a regular file: x\u202e\u000aFORGED' "$TMP/badreceipt-missing.err" || fail 'the missing-output refusal names the escaped path'
grep -Fq 'registered generated output x\u202e\u000aFORGED: line/RULES.md: not a regular in-root file' "$TMP/badreceipt-fifo.err" || fail 'the unreadable-output refusal names the escaped path'
pass 'bidirectional controls in file names are escaped in the map, the JSON inventory and refusals, and refused in options'

# An exclusion the scan never reached (a folder that does not exist yet) is still recorded and reused.
make_scope_fixture "$TMP/notyet"
bash "$INDEX" "$TMP/notyet" --exclude-dir ios > /dev/null || fail 'index excluding a missing folder exits 0'
bash "$INDEX" "$TMP/notyet" --same-scope --preview > "$TMP/notyet-same.out" || fail '--same-scope with a missing excluded folder exits 0'
bash "$INDEX" "$TMP/notyet" --exclude-dir ios --preview > "$TMP/notyet-explicit.out" || fail 'explicit preview with a missing excluded folder exits 0'
cmp -s "$TMP/notyet-same.out" "$TMP/notyet-explicit.out" || fail '--same-scope keeps an exclusion the scan never reached'
bash "$INDEX" "$TMP/notyet" --preview > /dev/null 2> "$TMP/notyet-plain.err" || fail 'plain refresh exits 0'
grep -Fq '`ios`' "$TMP/notyet-plain.err" || fail 'a plain refresh names a dropped exclusion the scan never reached'
pass 'an exclusion of a folder that does not exist yet is recorded, reused and reported'

# Review round 4. An index before source recording wrote only the limitation line for an --exclude-dir folder the scan
# never reached, not the folder (the Expo case: ios/ before prebuild). --same-scope must not scan that folder silently.
remark_map() {
  python3 -I -B - "$1" "$2" "$3" <<'PY'
import hashlib, re, sys
path, old, new = sys.argv[1], sys.argv[2].encode(), sys.argv[3].encode()
data = open(path, "rb").read()
body = data[:re.search(rb"<!-- spec-harness-index:v1 sha256=", data).start()]
assert old in body, old
body = body.replace(old, new)
open(path, "wb").write(body + b"<!-- spec-harness-index:v1 sha256=" + hashlib.sha256(body).hexdigest().encode() + b" -->\n")
PY
}
make_scope_fixture "$TMP/oldnotyet"
bash "$INDEX" "$TMP/oldnotyet" --exclude-dir ios > /dev/null || fail 'index excluding a missing folder exits 0'
remark_map "$TMP/oldnotyet/ai_rules/context_map.md" $'- Explicit directory exclusions the scan did not reach: `ios`; repeat --exclude-dir options on refresh, or run index with --same-scope.\n' ''
grep -Fxq -- '- Explicit directory exclusions are outside the declared inventory scope; repeat --exclude-dir options on refresh.' "$TMP/oldnotyet/ai_rules/context_map.md" || fail 'the older map keeps its exclusion limitation line'
mkdir -p "$TMP/oldnotyet/ios"; printf 'export const app = 1;\n' > "$TMP/oldnotyet/ios/app.js"
if bash "$INDEX" "$TMP/oldnotyet" --same-scope --preview > /dev/null 2> "$TMP/oldnotyet-same.err"; then fail '--same-scope reused an older map that does not name its excluded folder'; fi
grep -Fq 'may not name all its folders' "$TMP/oldnotyet-same.err" || fail 'the refusal says the map does not name its excluded folders'
bash "$INDEX" "$TMP/oldnotyet" --preview > /dev/null 2> "$TMP/oldnotyet-plain.err" || fail 'a plain refresh over that map exits 0'
grep -Fq 'SCOPE:' "$TMP/oldnotyet-plain.err" && grep -Fq 'may not name all its folders' "$TMP/oldnotyet-plain.err" || fail 'a plain refresh says the recorded exclusions are unknown'
# The older index wrote no Source HEAD line, which every map from this index has. With one folder reached and one not,
# its map names only the reached one; it is refused too (and so, once, is an older map whose folders were all reached).
for case in mixed:'--exclude-dir gen --exclude-dir ios' reached:'--exclude-dir gen'; do
  old_case="old${case%%:*}"; make_scope_fixture "$TMP/$old_case"
  # shellcheck disable=SC2086
  bash "$INDEX" "$TMP/$old_case" ${case#*:} > /dev/null || fail "index exits 0 ($old_case)"
  python3 -I -B - "$TMP/$old_case/ai_rules/context_map.md" <<'PY'
import hashlib, re, sys
path = sys.argv[1]
data = open(path, "rb").read()
body = data[:re.search(rb"<!-- spec-harness-index:v1 sha256=", data).start()]
body, heads = re.subn(rb"- Source HEAD: `[^`\n]*`\n", b"", body)
body = re.sub(rb"- Explicit directory exclusions the scan did not reach: [^\n]*\n", b"", body)
assert heads == 1, heads
open(path, "wb").write(body + b"<!-- spec-harness-index:v1 sha256=" + hashlib.sha256(body).hexdigest().encode() + b" -->\n")
PY
  mkdir -p "$TMP/$old_case/ios"; printf 'export const app = 1;\n' > "$TMP/$old_case/ios/app.js"
  if bash "$INDEX" "$TMP/$old_case" --same-scope --preview > /dev/null 2> "$TMP/$old_case-same.err"; then fail "--same-scope reused the exclusions of a map without Source HEAD ($old_case)"; fi
  grep -Fq 'may not name all its folders' "$TMP/$old_case-same.err" || fail "the refusal says why ($old_case)"
done
# An older index also accepted a backtick in an --exclude-dir folder; its row is not in the format index writes now.
make_scope_fixture "$TMP/oldtick"
bash "$INDEX" "$TMP/oldtick" --exclude-dir gen > /dev/null || fail 'index with --exclude-dir exits 0'
remark_map "$TMP/oldtick/ai_rules/context_map.md" '- `gen`: explicit directory exclusion' '- `ge`n`: explicit directory exclusion'
if bash "$INDEX" "$TMP/oldtick" --same-scope --preview > /dev/null 2> "$TMP/oldtick-same.err"; then fail '--same-scope dropped an older exclusion row with a backtick'; fi
grep -Fq 'does not fit the format index writes' "$TMP/oldtick-same.err" || fail 'the backtick-row refusal says why'
pass 'an older map that does not name an excluded folder is refused by --same-scope and reported by a plain refresh'

# A path that cannot be recorded in the map is refused, and the message says why.
make_scope_fixture "$TMP/tickopt"
for option in --source --exclude-dir; do
  if bash "$INDEX" "$TMP/tickopt" "$option" 'src/a`b' --preview > /dev/null 2> "$TMP/tickopt.err"; then fail "$option with a backtick is refused"; fi
  grep -Fq 'backtick or control character' "$TMP/tickopt.err" || fail "the $option refusal names the backtick"
done
pass 'a backtick in --source or --exclude-dir is refused with its reason'

# A generated-looking previous inventory with odd field types or bytes never crashes a plain run.
make_scope_fixture "$TMP/oddjson"
mkdir -p "$TMP/oddjson/ai_rules"; printf '# My own notes\n' > "$TMP/oddjson/ai_rules/context_map.md"
bash "$INDEX" "$TMP/oddjson" > /dev/null || fail 'JSON index exits 0'
python3 -I -B - "$TMP/oddjson/ai_rules/project_inventory.json" <<'PY'
import hashlib, json, sys
path = sys.argv[1]
value = json.load(open(path)); value.pop("integrity")
value["packages"][0]["representative_sources"] = 5
value["scan"]["excluded_directories"] = ["x\nSCOPE: forged line\x1b[31m"]
canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
value["integrity"] = {"sha256": hashlib.sha256(canonical).hexdigest()}
open(path, "w", encoding="utf-8").write(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
PY
bash "$INDEX" "$TMP/oddjson" --preview > /dev/null 2> "$TMP/oddjson.err" || fail 'a plain run over odd recorded types exits 0'
! grep -q 'Traceback' "$TMP/oddjson.err" || fail 'odd recorded types must not crash'
! grep -q '^SCOPE: forged' "$TMP/oddjson.err" || fail 'a recorded path cannot forge its own SCOPE line'
! grep -q $'\x1b' "$TMP/oddjson.err" || fail 'control characters from a recorded path are escaped on stderr'
if bash "$INDEX" "$TMP/oddjson" --same-scope --preview > /dev/null 2> "$TMP/oddjson-same.err"; then fail '--same-scope refuses a recorded path with control characters'; fi
grep -Fq 'invalid --exclude-dir path' "$TMP/oddjson-same.err" || fail 'the refusal names the bad recorded path'
make_scope_fixture "$TMP/badutf"
bash "$INDEX" "$TMP/badutf" > /dev/null || fail 'Markdown index exits 0'
python3 -I -B - "$TMP/badutf/ai_rules/context_map.md" <<'PY'
import hashlib, re, sys
path = sys.argv[1]
data = open(path, "rb").read()
body = data[:re.search(rb"<!-- spec-harness-index:v1 sha256=", data).start()] + b"- \xff\xfe broken bytes\n"
open(path, "wb").write(body + b"<!-- spec-harness-index:v1 sha256=" + hashlib.sha256(body).hexdigest().encode() + b" -->\n")
PY
bash "$INDEX" "$TMP/badutf" --preview > /dev/null 2> "$TMP/badutf.err" || fail 'a plain run over a map with invalid UTF-8 exits 0'
! grep -q 'Traceback' "$TMP/badutf.err" || fail 'invalid UTF-8 in the previous map must not crash'
pass 'odd recorded types and bytes are handled without a crash, and recorded paths cannot forge output'

# Well-known Composer frameworks are signals too.
mkdir -p "$TMP/drupal/src"
printf '{"name":"acme/site","require":{"drupal/core":"^10","slim/slim":"^4"}}\n' > "$TMP/drupal/composer.json"
printf '<?php\n' > "$TMP/drupal/src/a.php"
bash "$INDEX" "$TMP/drupal" --preview > "$TMP/drupal.out" || fail 'index of a Drupal site exits 0'
grep -Fxq -- '- Stack signals: `drupal/core`, `slim/slim`' "$TMP/drupal.out" || fail 'well-known Composer frameworks are stack signals'
pass 'well-known Composer frameworks are recognised by name'

# Review round 2. An index from before control characters were escaped wrote file names raw. Its map passes the
# integrity marker, so a name with line breaks could forge option lines; such a map is not trusted for scope.
as_unescaped_map() {
  python3 -I -B - "$1" <<'PY'
import hashlib, re, sys
path = sys.argv[1]
data = open(path, "rb").read()
body = data[:re.search(rb"<!-- spec-harness-index:v1 sha256=", data).start()].replace(b"\\u000a", b"\n")
open(path, "wb").write(body + b"<!-- spec-harness-index:v1 sha256=" + hashlib.sha256(body).hexdigest().encode() + b" -->\n")
PY
}
forged_old_map() {
  make_scope_fixture "$TMP/$1"
  printf 'export const k = 1;\n' > "$TMP/$1/k.js"
  : > "$TMP/$1/$2"
  bash "$INDEX" "$TMP/$1" > /dev/null || fail "index with a forging file name exits 0 ($1)"
  as_unescaped_map "$TMP/$1/ai_rules/context_map.md"
  if bash "$INDEX" "$TMP/$1" --same-scope --preview > "$TMP/$1-same.out" 2> "$TMP/$1-same.err"; then
    fail "--same-scope trusted options forged in an older map ($1)"
  fi
  grep -Fq 'does not fit the format index writes' "$TMP/$1-same.err" || fail "the refusal says why ($1)"
  bash "$INDEX" "$TMP/$1" --preview > /dev/null 2> "$TMP/$1-plain.err" || fail "a plain refresh over an older forged map exits 0 ($1)"
  ! grep -Fq 'SCOPE:' "$TMP/$1-plain.err" || fail "a plain refresh warns about options forged in an older map ($1)"
}
forged_old_map oldmap ".env"$'\n''- `src`: explicit directory exclusion: excluded by --exclude-dir'$'\n''- Explicit representative sources: `k.js`; repeat --source options on refresh, or run index with --same-scope.'$'\n''- `x'
# Every line of this one fits a map line; the forged exclusion has no limitation line, which a real --exclude-dir run writes.
forged_old_map oldmapfit 'a`: excluded file: environment file'$'\n''- `src`: explicit directory exclusion: excluded by --exclude-dir'$'\n''- `z.pem'
# A line after the last limitation is outside the format too, even with a valid marker.
make_scope_fixture "$TMP/trailing"
bash "$INDEX" "$TMP/trailing" --exclude-dir gen > /dev/null || fail 'index with --exclude-dir exits 0'
python3 -I -B - "$TMP/trailing/ai_rules/context_map.md" <<'PY'
import hashlib, re, sys
path = sys.argv[1]
data = open(path, "rb").read()
body = data[:re.search(rb"<!-- spec-harness-index:v1 sha256=", data).start()] + b"- `src`: explicit directory exclusion: excluded by --exclude-dir\n"
open(path, "wb").write(body + b"<!-- spec-harness-index:v1 sha256=" + hashlib.sha256(body).hexdigest().encode() + b" -->\n")
PY
if bash "$INDEX" "$TMP/trailing" --same-scope --preview > /dev/null 2>&1; then fail '--same-scope trusted a map with a line after its limitations'; fi
pass 'options forged by a file name in an older unescaped map are refused by --same-scope and give no SCOPE line'

# With no context_map.md the run writes a new map, so it reuses nothing from a companion JSON inventory, however nested.
make_scope_fixture "$TMP/nomap"
mkdir -p "$TMP/nomap/ai_rules"; printf '# My own notes\n' > "$TMP/nomap/ai_rules/context_map.md"
bash "$INDEX" "$TMP/nomap" --exclude-dir gen > /dev/null || fail 'JSON index exits 0'
rm "$TMP/nomap/ai_rules/context_map.md"
if bash "$INDEX" "$TMP/nomap" --same-scope --preview > /dev/null 2> "$TMP/nomap-same.err"; then fail '--same-scope with no map reused the companion JSON inventory'; fi
grep -Fq 'no generated inventory' "$TMP/nomap-same.err" || fail 'the no-map refusal says why'
python3 -I -B -c 'import sys; open(sys.argv[1], "w").write("{\"a\":" + "[" * 1000000 + "]" * 1000000 + "}\n")' "$TMP/nomap/ai_rules/project_inventory.json"
bash "$INDEX" "$TMP/nomap" --preview > /dev/null 2> "$TMP/nomap-deep.err" || fail 'a run with no map and a deeply nested JSON exits 0'
! grep -q 'Traceback' "$TMP/nomap-deep.err" || fail 'a deeply nested JSON inventory must not crash a run with no map'
printf '# My own notes\n' > "$TMP/nomap/ai_rules/context_map.md"
if bash "$INDEX" "$TMP/nomap" --preview > /dev/null 2> "$TMP/nomap-deep-custom.err"; then fail 'a deeply nested JSON inventory is not overwritten'; fi
! grep -q 'Traceback' "$TMP/nomap-deep-custom.err" || fail 'a deeply nested JSON inventory is refused without a crash'
pass 'with no map nothing is reused from the JSON inventory, and deep nesting is refused without a crash'

# A backtick in a source file or package folder name leaves that sample unknown instead of giving a false SCOPE line.
make_scope_fixture "$TMP/tick"
mkdir -p "$TMP/tick/p\`kg/src"
printf '{"name":"tick-package"}\n' > "$TMP/tick/p\`kg/package.json"
printf 'export const t = 1;\n' > "$TMP/tick/p\`kg/src/a.js"
printf 'export const t = 1;\n' > "$TMP/tick/src/0\`tick.js"
bash "$INDEX" "$TMP/tick" > /dev/null || fail 'index with backtick names exits 0'
bash "$INDEX" "$TMP/tick" --preview > /dev/null 2> "$TMP/tick.err" || fail 'a refresh with backtick names exits 0'
! grep -Fq 'SCOPE:' "$TMP/tick.err" || fail 'an unchanged refresh with backtick names prints a SCOPE line'
bash "$INDEX" "$TMP/tick" --same-scope --preview > /dev/null || fail '--same-scope reuses a map that names files with backticks'
pass 'backtick names in sources and package folders give no false SCOPE line and keep --same-scope'

# Recorded options of the wrong type are refused, not dropped.
make_scope_fixture "$TMP/oddopts"
mkdir -p "$TMP/oddopts/ai_rules"; printf '# My own notes\n' > "$TMP/oddopts/ai_rules/context_map.md"
bash "$INDEX" "$TMP/oddopts" --exclude-dir gen --source src/g.js > /dev/null || fail 'JSON index exits 0'
python3 -I -B - "$TMP/oddopts/ai_rules/project_inventory.json" <<'PY'
import hashlib, json, sys
path = sys.argv[1]
value = json.load(open(path)); value.pop("integrity")
value["scan"]["excluded_directories"] = ["gen", 5]
canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
value["integrity"] = {"sha256": hashlib.sha256(canonical).hexdigest()}
open(path, "w", encoding="utf-8").write(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
PY
if bash "$INDEX" "$TMP/oddopts" --same-scope --preview > /dev/null 2> "$TMP/oddopts.err"; then fail '--same-scope dropped a recorded option of the wrong type'; fi
grep -Fq 'excluded_directories' "$TMP/oddopts.err" || fail 'the refusal names the malformed record'
bash "$INDEX" "$TMP/oddopts" --exclude-dir gen --source src/g.js --preview > /dev/null 2> "$TMP/oddopts-plain.err" || fail 'a run with explicit options over a malformed record exits 0'
! grep -q 'Traceback' "$TMP/oddopts-plain.err" || fail 'a malformed record must not crash'
pass 'recorded options of the wrong type are refused by --same-scope'


# Review round 3. A source whose name looks like two list items is compared as written, not split.
make_scope_fixture "$TMP/twoitems"
printf 'export const t = 1;\n' > "$TMP/twoitems/src/0a\`, \`b.js"
bash "$INDEX" "$TMP/twoitems" > /dev/null || fail 'index with a list-like source name exits 0'
bash "$INDEX" "$TMP/twoitems" --preview > /dev/null 2> "$TMP/twoitems.err" || fail 'a refresh with a list-like source name exits 0'
! grep -Fq 'SCOPE:' "$TMP/twoitems.err" || fail 'an unchanged refresh with a list-like source name prints a SCOPE line'
# An empty workspace pattern is written as an empty code span; that map is still the format index writes.
make_scope_fixture "$TMP/emptyws"
printf '{"name":"emptyws","workspaces":[""]}\n' > "$TMP/emptyws/package.json"
bash "$INDEX" "$TMP/emptyws" --exclude-dir gen > /dev/null || fail 'index with an empty workspace pattern exits 0'
bash "$INDEX" "$TMP/emptyws" --same-scope --preview > /dev/null || fail '--same-scope reuses a map with an empty workspace pattern'
# A long crafted line cannot make reading the previous map slow (no backtracking regex over a whole line).
make_scope_fixture "$TMP/slowmap"
bash "$INDEX" "$TMP/slowmap" > /dev/null || fail 'index exits 0'
python3 -I -B - "$TMP/slowmap/ai_rules/context_map.md" <<'PY'
import hashlib, re, sys
path = sys.argv[1]
data = open(path, "rb").read()
start = re.search(rb"## Project instructions and workspace evidence\n\n", data).end()
body = data[:start] + b"- `" + b"`: read (" * 120000 + b"\n" + data[start:re.search(rb"<!-- spec-harness-index:v1 sha256=", data).start()]
open(path, "wb").write(body + b"<!-- spec-harness-index:v1 sha256=" + hashlib.sha256(body).hexdigest().encode() + b" -->\n")
PY
python3 -I -B - "$INDEX" "$TMP/slowmap" <<'PY' || fail 'a long crafted line in the previous map made a plain run slow'
import os, signal, subprocess, sys
child = subprocess.Popen(["bash", sys.argv[1], sys.argv[2], "--preview"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
try:
    sys.exit(child.wait(timeout=20))
except subprocess.TimeoutExpired:
    os.killpg(child.pid, signal.SIGKILL)
    sys.exit(1)
PY
# JSON the parser accepts but cannot hold (a huge integer, a lone surrogate) is refused without a crash.
for odd in '{"n":1'"$(printf '0%.0s' $(seq 5000))"'}' '{"generated_by":"spec-harness-index","schema_version":1,"integrity":{"sha256":"x"},"s":"\ud800"}'; do
  make_scope_fixture "$TMP/oddnum"
  mkdir -p "$TMP/oddnum/ai_rules"; printf '# My own notes\n' > "$TMP/oddnum/ai_rules/context_map.md"
  printf '%s\n' "$odd" > "$TMP/oddnum/ai_rules/project_inventory.json"
  bash "$INDEX" "$TMP/oddnum" --preview > /dev/null 2> "$TMP/oddnum.err" || true
  ! grep -q 'Traceback' "$TMP/oddnum.err" || fail 'an unholdable JSON value crashes index'
  rm -rf "$TMP/oddnum"
done
pass 'list-like names, empty workspace patterns, long crafted lines and unholdable JSON values are handled'

printf 'All index fixtures passed.\n'
