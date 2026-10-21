#!/usr/bin/env python3
"""Write or check ai_rules/stack.md: the one file in a target that names package versions.

Usage: sh_stack.py <target> [--check]

The file is built only from the target's manifests and lockfiles, so it is the same every time for
the same inputs. Rules, skills and roles name a package and link here instead of copying its
version; the readiness check rebuilds this file in memory and refuses READY when it differs.
"""
import json
import os
import re
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sh_safe_io import MAX_FILE_BYTES, WriteRefused, read_bounded_result, safe_relative, write_regular

STACK_PATH = "ai_rules/stack.md"
MARKER = "<!-- spec-harness-stack:v1 -->"
VERSION = re.compile(r"(\d+(?:\.\d+)+)(-[0-9A-Za-z.-]+)?")


def _read(root, rel):
    if not safe_relative(rel):
        return None
    data, _ = read_bounded_result(rel, MAX_FILE_BYTES, root=str(root))
    return data


def _join(package, name):
    return name if package == "." else f"{package}/{name}"


def package_paths(root):
    """Package boundaries from the structured inventory, else the root alone."""
    data = _read(root, "ai_rules/project_inventory.json")
    try:
        rows = json.loads(data)["packages"]
        paths = [row["path"] for row in rows if isinstance(row, dict) and isinstance(row.get("path"), str)
                 and (row["path"] == "." or safe_relative(row["path"]))]
    except (TypeError, ValueError, KeyError, UnicodeDecodeError):
        paths = []
    if not paths:
        # The generated Markdown map names each package boundary as a "### `path`" heading.
        text = (_read(root, "ai_rules/context_map.md") or b"").decode("utf-8", errors="replace")
        paths = [path for path in re.findall(r"(?m)^### `([^`]+)`$", text) if path == "." or safe_relative(path)]
    return paths or ["."]


def _ancestors(package):
    """The package directory, then each parent up to the target root."""
    parts = [] if package == "." else package.split("/")
    for size in range(len(parts), -1, -1):
        yield "/".join(parts[:size]) or "."


def _find_lockfile(root, package, names):
    for directory in _ancestors(package):
        for name in names:
            rel = _join(directory, name)
            data = _read(root, rel)
            if data is not None:
                return rel, directory, data
    return None, None, None


def _yarn_versions(text):
    """Map each `name@range` spec in a yarn.lock (classic or berry) to its resolved version."""
    resolved, specs = {}, []
    for line in text.splitlines():
        if line and not line[0].isspace() and line.rstrip().endswith(":"):
            specs = [spec.strip().strip('"') for spec in line.rstrip()[:-1].split(",")]
            continue
        match = re.match(r'\s+version:?\s+"?([^"\s]+)"?\s*$', line)
        if match and specs:
            for spec in specs:
                resolved[re.sub(r"@npm:", "@", spec)] = match.group(1)
            specs = []
    return resolved


def _npm_rows(root, package, data):
    try:
        manifest = json.loads(data)
    except (ValueError, UnicodeDecodeError):
        return None, []
    if not isinstance(manifest, dict):
        return None, []
    lock_rel, lock_dir, lock_data = _find_lockfile(root, package, ("package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock"))
    npm_lock, yarn_lock = {}, {}
    if lock_rel and lock_rel.endswith("package-lock.json"):
        try:
            npm_lock = json.loads(lock_data)
        except (ValueError, UnicodeDecodeError):
            npm_lock = {}
    elif lock_rel and lock_rel.endswith("yarn.lock"):
        yarn_lock = _yarn_versions(lock_data.decode("utf-8", errors="replace"))
    inner = "" if lock_dir is None or package == lock_dir else (package if lock_dir == "." else package[len(lock_dir) + 1:])

    def locked(name, declared):
        if npm_lock:
            entries = npm_lock.get("packages") if isinstance(npm_lock.get("packages"), dict) else {}
            for key in ([f"{inner}/node_modules/{name}"] if inner else []) + [f"node_modules/{name}"]:
                if isinstance(entries.get(key), dict) and isinstance(entries[key].get("version"), str):
                    return entries[key]["version"]
            legacy = npm_lock.get("dependencies")
            if isinstance(legacy, dict) and isinstance(legacy.get(name), dict) and isinstance(legacy[name].get("version"), str):
                return legacy[name]["version"]
        if yarn_lock:
            return yarn_lock.get(f"{name}@{declared}")
        return None

    rows = []
    for kind, key in (("dependency", "dependencies"), ("dev", "devDependencies"), ("peer", "peerDependencies")):
        section = manifest.get(key)
        if not isinstance(section, dict):
            continue
        for name in sorted(section):
            declared = section[name] if isinstance(section[name], str) else "?"
            rows.append({"name": name, "declared": declared, "locked": locked(name, declared), "kind": kind})
    note = lock_rel if lock_rel and (npm_lock or yarn_lock) else (f"{lock_rel} (format not read)" if lock_rel else None)
    return note, rows


def _normal(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def _python_rows(root, package, data):
    try:
        manifest = tomllib.loads(data.decode("utf-8-sig"))
    except (tomllib.TOMLDecodeError, UnicodeDecodeError):
        return None, []
    lock_rel, _, lock_data = _find_lockfile(root, package, ("uv.lock", "poetry.lock"))
    locked = {}
    if lock_data is not None:
        try:
            for row in tomllib.loads(lock_data.decode("utf-8-sig")).get("package", []):
                if isinstance(row, dict) and isinstance(row.get("name"), str) and isinstance(row.get("version"), str):
                    locked[_normal(row["name"])] = row["version"]
        except (tomllib.TOMLDecodeError, UnicodeDecodeError):
            lock_rel = f"{lock_rel} (format not read)"
    rows = []
    project = manifest.get("project") if isinstance(manifest.get("project"), dict) else {}
    for spec in project.get("dependencies", []) if isinstance(project.get("dependencies"), list) else []:
        match = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*([^;]*)", spec) if isinstance(spec, str) else None
        if match:
            rows.append({"name": match.group(1), "declared": match.group(2).strip() or "*",
                         "locked": locked.get(_normal(match.group(1))), "kind": "dependency"})
    poetry = manifest.get("tool", {}).get("poetry", {}) if isinstance(manifest.get("tool"), dict) else {}
    poetry_deps = poetry.get("dependencies") if isinstance(poetry, dict) else None
    for name in sorted(poetry_deps) if isinstance(poetry_deps, dict) else []:
        value = poetry_deps[name]
        declared = value if isinstance(value, str) else (value.get("version", "?") if isinstance(value, dict) else "?")
        rows.append({"name": name, "declared": declared, "locked": locked.get(_normal(name)), "kind": "dependency"})
    return lock_rel, rows


def collect(root):
    """Return [(package_path, manifest, lockfile note, rows)] for every package boundary."""
    result = []
    for package in package_paths(root):
        for manifest, reader in (("package.json", _npm_rows), ("pyproject.toml", _python_rows)):
            data = _read(root, _join(package, manifest))
            if data is None:
                continue
            note, rows = reader(root, package, data)
            result.append((package, _join(package, manifest), note, rows))
    return result


def render(root):
    """The exact bytes of ai_rules/stack.md for the target's current manifests and lockfiles."""
    lines = [
        "# Stack", "", MARKER, "",
        "Generated by `spec-harness stack` from the manifests and lockfiles named below. Do not edit it by",
        "hand: run `spec-harness stack <target>` again after a dependency change. This is the only file that",
        "names package versions. Rules, skills and roles name the package and link to this file instead.",
    ]
    collected = collect(root)
    if not collected:
        lines += ["", "No supported manifest (`package.json`, `pyproject.toml`) was found."]
    for package, manifest, note, rows in collected:
        lines += ["", f"## Package `{package}`", "",
                  f"Manifest: `{manifest}`. Lockfile: " + (f"`{note}`." if note else "none found; locked versions are unknown.")]
        if not rows:
            lines += ["", "No dependencies are declared."]
            continue
        lines += ["", "| Package | Declared | Locked | Kind |", "|---|---|---|---|"]
        for row in rows:
            lines.append(f"| `{row['name']}` | `{row['declared']}` | " + (f"`{row['locked']}`" if row["locked"] else "-") + f" | {row['kind']} |")
    return ("\n".join(lines) + "\n").encode()


def entries(root):
    """Every (package_path, name, declared, locked) row, for the readiness check."""
    return [(package, row["name"], row["declared"], row["locked"]) for package, _, _, rows in collect(root) for row in rows]


def version_key(text):
    """(numbers, 0 for a prerelease, 1 for a release): a prerelease sorts before its release (semver)."""
    match = VERSION.search(text or "")
    if not match:
        return None
    return tuple(int(part) for part in match.group(1).split(".")), (0 if match.group(2) else 1)


def satisfies(version, requirement):
    """True when a version satisfies every space-separated comparator (>=, >, <=, <, =)."""
    have = version_key(version)
    if have is None:
        return False
    for comparator in requirement.split():
        match = re.fullmatch(r"(>=|<=|>|<|=)?v?(\d+(?:\.\d+)*)", comparator)
        if not match:
            return False
        want = tuple(int(part) for part in match.group(2).split("."))
        size = max(len(have[0]), len(want))
        left = (have[0] + (0,) * (size - len(have[0])), have[1])
        right = (want + (0,) * (size - len(want)), 1)
        operator = match.group(1) or "="
        if not {">=": left >= right, "<=": left <= right, ">": left > right, "<": left < right, "=": left == right}[operator]:
            return False
    return True


def main(argv):
    if len(argv) not in (1, 2) or (len(argv) == 2 and argv[1] != "--check"):
        print("usage: spec-harness stack <target> [--check]", file=sys.stderr)
        return 2
    root = Path(argv[0]).expanduser()
    if not root.is_dir():
        print(f"stack: target is not a directory: {root}", file=sys.stderr)
        return 2
    root = root.resolve()
    wanted = render(root)
    current = _read(root, STACK_PATH)
    if len(argv) == 2:
        if current == wanted:
            print(f"READY: {STACK_PATH} matches the manifests and lockfiles")
            return 0
        print(f"PENDING: {STACK_PATH} is missing or stale; run spec-harness stack <target>")
        return 1
    if current is not None and MARKER.encode() not in current:
        print(f"PENDING: {STACK_PATH} exists and is not generated by Spec Harness; preserved")
        return 1
    if os.path.lexists(root / STACK_PATH) and current is None:
        print(f"PENDING: {STACK_PATH} is a link or unreadable; preserved")
        return 1
    try:
        write_regular(str(root), STACK_PATH, wanted)
    except WriteRefused as error:
        print(f"PENDING: {error}")
        return 1
    print(f"WROTE: {STACK_PATH} ({len(entries(root))} dependencies)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
