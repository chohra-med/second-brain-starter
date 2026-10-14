#!/usr/bin/env bash
# Rewrites install-manifest.json in place: every entry's sha256 from its current source file, and
# harnessVersion from package.json. Nothing else changes (key order, indentation and the final LF are
# kept). Exits 1 without writing if any entry's source file is missing.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HARNESS_DIR="${SPEC_HARNESS_DIR:-$(cd "$TEST_DIR/../.." && pwd -P)}"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'update-install-manifest: python3 is required\n' >&2
  exit 1
fi

python3 -I - "$HARNESS_DIR" <<'PYEOF'
import hashlib, json, os, sys

root = sys.argv[1]
path = os.path.join(root, "install-manifest.json")
raw = open(path, "rb").read().decode("utf-8")
manifest = json.loads(raw)
if json.dumps(manifest, indent=2, ensure_ascii=False) + "\n" != raw:
    sys.stderr.write("update-install-manifest: install-manifest.json is not in the format this script writes; refusing to reformat it\n")
    sys.exit(1)

version = json.load(open(os.path.join(root, "package.json"), encoding="utf-8"))["version"]
missing = []
for entry in manifest["entries"]:
    source = os.path.join(root, entry["source"])
    if not os.path.isfile(source):
        missing.append("%s (destination %s)" % (entry["source"], entry["destination"]))
        continue
    entry["sha256"] = hashlib.sha256(open(source, "rb").read()).hexdigest()

if missing:
    sys.stderr.write("update-install-manifest: source file missing; install-manifest.json was not written:\n")
    for item in missing:
        sys.stderr.write("  " + item + "\n")
    sys.exit(1)

manifest["harnessVersion"] = version
open(path, "w", encoding="utf-8").write(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
print("update-install-manifest: %d entries rehashed; harnessVersion %s" % (len(manifest["entries"]), version))
PYEOF
