#!/usr/bin/env bash
# spec-harness-index — bounded, read-only-first inventory for an existing project.
# Requires Bash and Python 3.11+ (stdlib tomllib parses pyproject.toml safely).
set -euo pipefail

if [[ $# -lt 1 ]]; then
  printf 'Usage: %s <target-dir> [--source <repo-relative-path> ...]\nPython 3.11+ is required for safe TOML manifest parsing.\n' "$0" >&2
  exit 2
fi
target="$1"
shift
command -v python3 >/dev/null 2>&1 || {
  printf 'spec-harness-index requires Python 3.11+; install Python and retry.\n' >&2
  exit 2
}

python3 - "$target" "$@" <<'PY'
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

if sys.version_info < (3, 11):
    raise SystemExit("spec-harness-index requires Python 3.11+ for safe TOML parsing")

import tomllib

MAX_DIRECTORIES = 5_000
MAX_FILES = 25_000
MAX_MANIFEST_BYTES = 256 * 1024
MAX_INSTRUCTION_BYTES = 256 * 1024
MAX_SOURCE_BYTES = 128 * 1024
MAX_SAMPLE_BYTES = 2 * 1024 * 1024
MAX_SOURCES_PER_PACKAGE = 5
MAX_EXPLICIT_SOURCES = 5
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
GENERATED_IDENTITY_PATHS = {
    "ai_rules/project_inventory.json",
    ".claude/agents/.init-synthesis.json",
    ".claude/skills/spec-harness-architecture/SKILL.md",
    ".claude/skills/spec-harness-performance/SKILL.md",
    ".claude/skills/spec-harness-packages/SKILL.md",
}
GENERATED_IDENTITY_SKILL_DIRS = {
    ".claude/skills/spec-harness-architecture",
    ".claude/skills/spec-harness-performance",
    ".claude/skills/spec-harness-packages",
}

SOURCE_SUFFIXES = {
    ".c", ".cc", ".cpp", ".cs", ".dart", ".ex", ".exs", ".go", ".h", ".hpp",
    ".java", ".js", ".jsx", ".kt", ".kts", ".m", ".mm", ".php", ".py", ".rb",
    ".rs", ".scala", ".sh", ".sql", ".swift", ".ts", ".tsx", ".vue", ".svelte",
}
SOURCE_NAMES = {
    "app.py", "application.py", "index.js", "index.jsx", "index.ts", "index.tsx",
    "main.c", "main.cpp", "main.go", "main.java", "main.js", "main.py", "main.rs",
    "main.ts", "main.tsx", "lib.rs", "mod.rs",
}
IGNORED_DIRS = {
    ".cache", ".expo", ".gradle", ".hg", ".idea", ".mypy_cache", ".next", ".nuxt",
    ".pytest_cache", ".ruff_cache", ".svn", ".tox", ".turbo", ".venv", "__pycache__",
    "build", "Carthage", "coverage", "dist", "DerivedData", "node_modules", "Pods",
    "target", "vendor", "venv",
}
PRIVATE_DIRS = {".aws", ".gnupg", ".kube", ".ssh", "cert", "certs", "credentials", "private", "secrets", "signing"}
DATA_DIRS = {"data", "datasets"}
DATA_SUFFIXES = {".avro", ".csv", ".db", ".duckdb", ".feather", ".parquet", ".sqlite", ".sqlite3", ".tsv"}
LOCK_NAMES = {
    "Cargo.lock", "Gemfile.lock", "Pipfile.lock", "bun.lock", "bun.lockb", "composer.lock",
    "go.sum", "npm-shrinkwrap.json", "package-lock.json", "poetry.lock", "pnpm-lock.yaml",
    "uv.lock", "yarn.lock",
}
MANIFEST_NAMES = {
    "Cargo.toml", "Pipfile", "Package.swift", "build.gradle", "build.gradle.kts",
    "composer.json", "deno.json", "deno.jsonc", "go.mod", "mix.exs",
    "package.json", "pom.xml", "pyproject.toml", "setup.cfg", "setup.py", "pubspec.yaml",
    "requirements.txt", "Gemfile",
}
RULE_NAMES = {
    "AGENTS.md", "AGENTS.override.md", "CLAUDE.md", "CONTRIBUTING.md", "copilot-instructions.md",
    "README.md", "RULES.md",
}
WORKSPACE_NAMES = {"go.work", "pnpm-workspace.yaml"}
MANIFEST_GLOBS = ("requirements-*.txt", "*.csproj", "*.fsproj")
GENERATED_PATTERNS = (
    re.compile(r"(?:^|[._-])generated(?:[._-]|$)", re.I),
    re.compile(r"\.min\.(?:js|css)$", re.I),
)

requested = Path(sys.argv[1]).expanduser()
source_args = sys.argv[2:]
explicit_source_paths = []
index = 0
while index < len(source_args):
    if source_args[index] != "--source" or index + 1 >= len(source_args):
        raise SystemExit("usage error: expected repeated --source <repo-relative-path> options")
    path = source_args[index + 1]
    if (
        not path
        or "\x00" in path
        or "\\" in path
        or os.path.isabs(path)
        or any(part in {"", ".", ".."} for part in path.split("/"))
        or Path(path).as_posix() != path
    ):
        raise SystemExit(f"invalid --source path; expected a normalized in-root relative path: {path!r}")
    if path in explicit_source_paths:
        raise SystemExit(f"duplicate --source path: {path}")
    explicit_source_paths.append(path)
    if len(explicit_source_paths) > MAX_EXPLICIT_SOURCES:
        raise SystemExit(f"too many --source paths: maximum is {MAX_EXPLICIT_SOURCES} total")
    index += 2

root_path = Path(os.path.realpath(requested))
if not root_path.is_dir():
    raise SystemExit(f"target is not a readable directory: {requested}")
root = str(root_path)
exclusions = []
manifest_paths = {}
lockfiles = []
workspace_files = []
instruction_files = []
source_paths = []
visited_dirs = 0
scanned_dirs = 0
visited_files = 0
scanned_files = 0
truncated = False


def rel(path):
    value = os.path.relpath(path, root)
    return "." if value == "." else value.replace(os.sep, "/")


def add_exclusion(path, category, reason):
    item = {"path": path, "category": category, "reason": reason}
    if item not in exclusions:
        exclusions.append(item)


def walk_error(error):
    global truncated
    truncated = True
    path = getattr(error, "filename", None) or root
    path_rel = rel(path) if is_inside(path) else "."
    add_exclusion(path_rel, "unreadable directory", f"cannot enumerate ({error.__class__.__name__})")


def is_inside(path):
    try:
        return os.path.commonpath((root, os.path.realpath(path))) == root
    except ValueError:
        return False


def hidden_or_private_file(name):
    low = name.lower()
    if low.startswith(".env"):
        return "environment file"
    if low in {".netrc", ".npmrc", ".pypirc", "credentials", "credentials.json", "id_dsa", "id_ecdsa", "id_ed25519", "id_rsa", "private_key", "secrets.json", "service-account.json", "token", "token.txt"}:
        return "credential or signing asset"
    if low.endswith((".jks", ".key", ".keystore", ".mobileprovision", ".p12", ".p8", ".pem", ".pfx")):
        return "credential or signing asset"
    if low in {".ds_store"} or low.endswith(".pyc"):
        return "generated or operating-system file"
    if Path(low).suffix in DATA_SUFFIXES:
        return "dataset or database file"
    if any(pattern.search(name) for pattern in GENERATED_PATTERNS):
        return "generated source file"
    return None


def is_manifest_name(name):
    return name in MANIFEST_NAMES or any(Path(name).match(pattern) for pattern in MANIFEST_GLOBS)


def is_instruction_file(path):
    name = os.path.basename(path)
    parts = path.split("/")
    in_rule_library = "ai_rules" in parts and name != "context_map.md"
    in_cursor_rules = any(parts[index:index + 2] == [".cursor", "rules"] for index in range(len(parts) - 1))
    return (
        name in RULE_NAMES
        or (
            name.endswith((".md", ".mdc"))
            and (in_rule_library or in_cursor_rules)
        )
        or (name == "copilot-instructions.md" and ".github" in parts)
    )


def instruction_scope(path):
    parts = path.split("/")
    if "ai_rules" in parts:
        return "/".join(parts[:parts.index("ai_rules")]) or "."
    for index in range(len(parts) - 1):
        if parts[index:index + 2] == [".cursor", "rules"]:
            return "/".join(parts[:index]) or "."
    if ".github" in parts and parts[-1] == "copilot-instructions.md":
        return "/".join(parts[:parts.index(".github")]) or "."
    directory = os.path.dirname(path).replace(os.sep, "/")
    return directory or "."


def read_bounded(path, limit):
    """Read a regular in-root file without following a final symlink."""
    try:
        info = os.lstat(path)
        if not stat.S_ISREG(info.st_mode) or not is_inside(path):
            return None, "not a regular in-root file"
        if info.st_size > limit:
            return None, f"exceeds {limit}-byte read limit"
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags)
        try:
            opened = os.fstat(fd)
            if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                return None, "file changed during inventory"
            chunks = []
            remaining = limit + 1
            while remaining:
                chunk = os.read(fd, min(remaining, 64 * 1024))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            data = b"".join(chunks)
            if len(data) > limit:
                return None, f"exceeds {limit}-byte read limit"
            return data, None
        finally:
            os.close(fd)
    except OSError as error:
        return None, f"unreadable ({error.__class__.__name__})"


def safe_string(value):
    return isinstance(value, str) and "\x00" not in value and len(value) <= 500


def add_dependency(names, value):
    if isinstance(value, str):
        match = re.match(r"\s*([A-Za-z0-9_.+-]+)", value)
        if match:
            names.add(match.group(1))


def js_manifest(data):
    obj = json.loads(data.decode("utf-8"))
    if not isinstance(obj, dict):
        raise ValueError("manifest must be a JSON object")
    result = {"status": "supported"}
    if safe_string(obj.get("name")):
        result["name"] = obj["name"]
    scripts = obj.get("scripts", {})
    result["scripts"] = sorted(key for key, value in scripts.items() if safe_string(key) and isinstance(value, str)) if isinstance(scripts, dict) else []
    deps = set()
    for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        mapping = obj.get(section, {})
        if isinstance(mapping, dict):
            deps.update(key for key, value in mapping.items() if safe_string(key) and isinstance(value, (str, dict)))
    result["dependencies"] = sorted(deps)
    result["stack_signals"] = sorted(deps.intersection({"expo", "react-native", "next", "react", "vite", "express", "fastify", "@nestjs/core"}))
    result["entrypoints"] = sorted({value for key in ("main", "module", "types", "typings") if safe_string(value := obj.get(key))})
    workspaces = obj.get("workspaces", [])
    if isinstance(workspaces, dict):
        workspaces = workspaces.get("packages", [])
    result["workspace_patterns"] = sorted(value for value in workspaces if safe_string(value)) if isinstance(workspaces, list) else []
    return result


def toml_manifest(data):
    obj = tomllib.loads(data.decode("utf-8"))
    result = {"status": "supported"}
    project = obj.get("project", {})
    deps = set()
    if isinstance(project, dict):
        if safe_string(project.get("name")):
            result["name"] = project["name"]
        for dep in project.get("dependencies", []) if isinstance(project.get("dependencies", []), list) else []:
            add_dependency(deps, dep)
        optional = project.get("optional-dependencies", {})
        if isinstance(optional, dict):
            for group in optional.values():
                if isinstance(group, list):
                    for dep in group:
                        add_dependency(deps, dep)
        scripts = project.get("scripts", {})
        result["scripts"] = sorted(key for key, value in scripts.items() if safe_string(key)) if isinstance(scripts, dict) else []
    poetry = obj.get("tool", {}).get("poetry", {}) if isinstance(obj.get("tool", {}), dict) else {}
    if isinstance(poetry, dict):
        mapping = poetry.get("dependencies", {})
        if isinstance(mapping, dict):
            deps.update(key for key in mapping if safe_string(key) and key.lower() != "python")
        groups = poetry.get("group", {})
        if isinstance(groups, dict):
            for group in groups.values():
                mapping = group.get("dependencies", {}) if isinstance(group, dict) else {}
                if isinstance(mapping, dict):
                    deps.update(key for key in mapping if safe_string(key))
    workspace = obj.get("tool", {}).get("uv", {}).get("workspace", {}) if isinstance(obj.get("tool", {}), dict) else {}
    if isinstance(workspace, dict):
        result["workspace_patterns"] = sorted(value for value in workspace.get("members", []) if safe_string(value))
    result["dependencies"] = sorted(deps)
    result["stack_signals"] = []
    result["entrypoints"] = []
    return result


def parse_manifest(name, data):
    try:
        if name == "package.json":
            result = js_manifest(data)
        elif name == "pyproject.toml":
            result = toml_manifest(data)
        else:
            return {"status": "unsupported", "reason": "manifest format is inventoried but not parsed"}
        return result
    except (UnicodeDecodeError, json.JSONDecodeError, tomllib.TOMLDecodeError, ValueError, TypeError):
        return {"status": "unsupported", "reason": "manifest is malformed or has an unsupported encoding"}


def classify_manifest(name):
    return "supported" if name in {"package.json", "pyproject.toml"} else "unsupported"


for directory, dirnames, filenames in os.walk(root, topdown=True, followlinks=False, onerror=walk_error):
    relative_dir = rel(directory)
    scanned_dirs += 1
    if relative_dir not in GENERATED_IDENTITY_SKILL_DIRS:
        visited_dirs += 1
    if scanned_dirs > MAX_DIRECTORIES:
        truncated = True
        add_exclusion(relative_dir, "scan limit", f"directory limit of {MAX_DIRECTORIES} reached; remaining tree not scanned")
        dirnames[:] = []
        break

    if relative_dir != "." and (".git" in dirnames or ".git" in filenames):
        add_exclusion(relative_dir, "nested repository", "nested repository contents are outside this inventory")
        dirnames[:] = []
        continue

    kept_dirs = []
    for name in sorted(dirnames):
        path = os.path.join(directory, name)
        path_rel = rel(path)
        if os.path.islink(path):
            add_exclusion(path_rel, "symbolic link", "directory symlinks are not followed")
        elif name == ".git":
            add_exclusion(path_rel, "repository metadata", "repository metadata is not scanned")
        elif name in IGNORED_DIRS:
            add_exclusion(path_rel, "generated/dependency directory", "directory class is excluded")
        elif name.lower() in PRIVATE_DIRS:
            add_exclusion(path_rel, "private/signing directory", "private and signing assets are not scanned")
        elif name.lower() in DATA_DIRS:
            add_exclusion(path_rel, "dataset directory", "dataset contents are not scanned")
        elif name.startswith(".env"):
            add_exclusion(path_rel, "environment path", "environment contents are not scanned")
        else:
            kept_dirs.append(name)
    dirnames[:] = kept_dirs

    for name in sorted(filenames):
        scanned_files += 1
        path = os.path.join(directory, name)
        path_rel = rel(path)
        if scanned_files > MAX_FILES:
            truncated = True
            add_exclusion(path_rel, "scan limit", f"file limit of {MAX_FILES} reached; remaining tree not scanned")
            dirnames[:] = []
            break
        if path_rel not in GENERATED_IDENTITY_PATHS:
            visited_files += 1
        if os.path.islink(path):
            add_exclusion(path_rel, "symbolic link", "file symlinks are not followed")
            continue
        if not is_inside(path):
            add_exclusion(path_rel, "path escape", "resolved path is outside the selected root")
            continue
        private_reason = hidden_or_private_file(name)
        if private_reason:
            add_exclusion(path_rel, "excluded file", private_reason)
            continue
        if name == ".git":
            add_exclusion(path_rel, "repository metadata", "repository metadata is not scanned")
            continue
        if is_manifest_name(name):
            manifest_paths.setdefault(relative_dir, []).append((name, path_rel, path))
        if name in LOCK_NAMES:
            lockfiles.append({"path": path_rel, "format": name, "status": "present; contents not parsed"})
        if name in WORKSPACE_NAMES:
            workspace_files.append({"path": path_rel, "format": name, "status": "present; contents not parsed"})
        if is_instruction_file(path_rel):
            instruction_files.append((path_rel, path))
        # The staged root loop.sh is the harness's own placeholder, not project source.
        harness_loop = path_rel == "loop.sh" and b"# Spec Harness minimal loop" in (read_bounded(path, 65536)[0] or b"")
        if Path(name).suffix.lower() in SOURCE_SUFFIXES and not harness_loop:
            source_paths.append((relative_dir, path_rel, path))

    if truncated:
        break

packages = {}
for package_path, files in sorted(manifest_paths.items()):
    package = {
        "path": package_path,
        "names": [],
        "manifests": [],
        "scripts": [],
        "dependencies": [],
        "stack_signals": [],
        "entrypoints": [],
        "representative_sources": [],
        "applicable_instructions": [],
    }
    names, scripts, dependencies, signals, entrypoints = set(), set(), set(), set(), set()
    for name, path_rel, absolute in sorted(files):
        manifest_row = {"path": path_rel, "format": name, "status": "unreadable"}
        if classify_manifest(name) == "unsupported":
            manifest_row.update({"status": "unsupported", "reason": "manifest format is inventoried but not parsed"})
        else:
            data, error = read_bounded(absolute, MAX_MANIFEST_BYTES)
            if error:
                manifest_row.update({"status": "unreadable", "reason": error})
                add_exclusion(path_rel, "manifest not read", error)
            else:
                parsed = parse_manifest(name, data)
                manifest_row.update(parsed)
                manifest_row["sha256"] = hashlib.sha256(data).hexdigest()
                if safe_string(parsed.get("name")):
                    names.add(parsed["name"])
                scripts.update(parsed.get("scripts", []))
                dependencies.update(parsed.get("dependencies", []))
                signals.update(parsed.get("stack_signals", []))
                entrypoints.update(parsed.get("entrypoints", []))
        package["manifests"].append(manifest_row)
    package["names"] = sorted(names)
    package["scripts"] = sorted(scripts)
    package["dependencies"] = sorted(dependencies)
    package["stack_signals"] = sorted(signals)
    package["entrypoints"] = sorted(entrypoints)
    packages[package_path] = package

instruction_rows = []
for path_rel, absolute in sorted(instruction_files):
    data, error = read_bounded(absolute, MAX_INSTRUCTION_BYTES)
    row = {"path": path_rel, "kind": "project instruction/startup document", "read_status": "read" if data is not None else "excluded"}
    if data is not None:
        row["sha256"] = hashlib.sha256(data).hexdigest()
        row["bytes"] = len(data)
    else:
        row["reason"] = error
        add_exclusion(path_rel, "instruction not read", error)
    instruction_rows.append(row)

package_paths = sorted(packages, key=lambda value: (value.count("/"), value))


def belongs_to_package(source_dir, package_path):
    if package_path == ".":
        return True
    return source_dir == package_path or source_dir.startswith(package_path + "/")


def deepest_package_for(source_dir):
    matches = [path for path in package_paths if belongs_to_package(source_dir, path)]
    return max(matches, key=lambda value: (value.count("/"), len(value))) if matches else None


owned_sources = {path: [] for path in package_paths}
for source_dir, path_rel, absolute in source_paths:
    owner = deepest_package_for(source_dir)
    if owner is not None:
        owned_sources[owner].append((path_rel, absolute))

explicit_sources_by_package = {}
explicit_source_bytes = {}
if explicit_source_paths and truncated:
    raise SystemExit("refusing selected-source inventory: project scan is incomplete")
for path_rel in explicit_source_paths:
    found = next(((source_dir, absolute) for source_dir, candidate, absolute in source_paths if candidate == path_rel), None)
    if found is None:
        raise SystemExit(f"selected path is not a scanned first-party source: {path_rel}")
    source_dir, absolute = found
    owner = deepest_package_for(source_dir)
    if owner is None:
        raise SystemExit(f"selected source has no discovered package owner: {path_rel}")
    data, error = read_bounded(absolute, MAX_SOURCE_BYTES)
    if error:
        raise SystemExit(f"selected source cannot be read safely: {path_rel} ({error})")
    explicit_sources_by_package.setdefault(owner, []).append((path_rel, absolute))
    explicit_source_bytes[path_rel] = data

if any(len(paths) > MAX_SOURCES_PER_PACKAGE for paths in explicit_sources_by_package.values()):
    raise SystemExit(f"too many selected sources for a package: maximum is {MAX_SOURCES_PER_PACKAGE}")

sampled_bytes = sum(len(data) for data in explicit_source_bytes.values())
if sampled_bytes > MAX_SAMPLE_BYTES:
    raise SystemExit(f"selected sources exceed aggregate read limit of {MAX_SAMPLE_BYTES} bytes")
for package_path in package_paths:
    package = packages[package_path]
    if package_path in explicit_sources_by_package:
        candidates = explicit_sources_by_package[package_path]
    else:
        entry_names = {Path(value).name for value in package["entrypoints"]}
        candidates = sorted(
            owned_sources[package_path],
            key=lambda item: (0 if Path(item[0]).name in entry_names | SOURCE_NAMES else 1, item[0].count("/"), item[0]),
        )[:MAX_SOURCES_PER_PACKAGE]
    for path_rel, absolute in candidates:
        if path_rel in explicit_source_bytes:
            data = explicit_source_bytes[path_rel]
            error = None
        else:
            if sampled_bytes >= MAX_SAMPLE_BYTES:
                add_exclusion(path_rel, "source sample limit", f"aggregate source read limit of {MAX_SAMPLE_BYTES} bytes reached")
                continue
            data, error = read_bounded(absolute, min(MAX_SOURCE_BYTES, MAX_SAMPLE_BYTES - sampled_bytes))
        if error:
            add_exclusion(path_rel, "source not sampled", error)
            package["representative_sources"].append({"path": path_rel, "read_status": "excluded", "reason": error})
            continue
        if path_rel not in explicit_source_bytes:
            sampled_bytes += len(data)
        text = data.decode("utf-8", errors="replace")
        package["representative_sources"].append({
            "path": path_rel,
            "read_status": "read",
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
            "lines": len(text.splitlines()),
        })

for package_path in package_paths:
    package = packages[package_path]
    ancestors = []
    if package_path == ".":
        ancestors = ["."]
    else:
        pieces = package_path.split("/")
        ancestors = ["."] + ["/".join(pieces[:index]) for index in range(1, len(pieces) + 1)]
    applicable = []
    for instruction in instruction_rows:
        path = instruction["path"]
        scope = instruction_scope(path)
        if scope in ancestors:
            applicable.append(path)
    package["applicable_instructions"] = sorted(set(applicable))

workspace_declarations = []
for package in packages.values():
    for manifest in package["manifests"]:
        for pattern in manifest.get("workspace_patterns", []):
            workspace_declarations.append({"owner": manifest["path"], "pattern": pattern})

inventory = {
    "format": "spec-harness-project-inventory",
    "schema_version": 1,
    # A fixed label: the checkout folder name would make the output (and its hash) differ per clone.
    "project_root_name": ".",
    "scan": {
        "scope": "selected root only",
        "source_scan_read_only": True,
        "complete": not truncated,
        "limits": {
            "directories": MAX_DIRECTORIES,
            "files": MAX_FILES,
            "manifest_bytes_each": MAX_MANIFEST_BYTES,
            "instruction_bytes_each": MAX_INSTRUCTION_BYTES,
            "source_bytes_each": MAX_SOURCE_BYTES,
            "source_bytes_total": MAX_SAMPLE_BYTES,
            "source_files_per_package": MAX_SOURCES_PER_PACKAGE,
        },
        "visited_directories": min(visited_dirs, MAX_DIRECTORIES),
        "visited_files": min(visited_files, MAX_FILES),
    },
    "packages": [packages[path] for path in package_paths],
    "rule_files": instruction_rows,
    "workspace_declarations": sorted(workspace_declarations, key=lambda row: (row["owner"], row["pattern"])),
    "workspace_files": sorted(workspace_files, key=lambda row: row["path"]),
    "lockfiles": sorted(lockfiles, key=lambda row: row["path"]),
    "exclusions": sorted(exclusions, key=lambda row: (row["path"], row["category"])),
    "limitations": [
        "Dependencies and commands are declaration names only; command bodies are not emitted or executed.",
        "Unsupported manifest formats are listed without parsing or execution.",
        "Paths and file evidence do not establish architecture, SOLID, performance, or best-practice claims.",
        "Lockfile contents, environment values, symlink targets, nested repositories, generated/dependency trees, signing assets, and datasets are excluded.",
    ],
}


def canonical_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def inventory_document(value):
    body = dict(value)
    body["generated_by"] = "spec-harness-index"
    body["integrity"] = {"sha256": hashlib.sha256(canonical_bytes(body)).hexdigest()}
    return body


def valid_inventory_bytes(data):
    try:
        value = json.loads(data.decode("utf-8"))
        integrity = value.pop("integrity")
        return value.get("generated_by") == "spec-harness-index" and value.get("schema_version") == 1 and integrity.get("sha256") == hashlib.sha256(canonical_bytes(value)).hexdigest()
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, AttributeError, TypeError):
        return False


def markdown_for(value):
    lines = [
        "# Project context map",
        "",
        "> Generated by spec-harness-index. This is bounded path and manifest evidence, not synthesized project guidance.",
        "",
        f"- Selected project root: `{value['project_root_name']}/`",
        f"- Scan complete: `{str(value['scan']['complete']).lower()}`; visited {value['scan']['visited_directories']} directories and {value['scan']['visited_files']} files.",
        "- Read limits and unsupported formats are recorded below. No command from a manifest was executed.",
        "",
        "## Package boundaries",
        "",
    ]
    if value["packages"]:
        for package in value["packages"]:
            manifests = ", ".join(f"`{item['path']}` ({item['status']})" for item in package["manifests"]) or "none"
            lines.extend([
                f"### `{package['path']}`",
                f"- Manifests: {manifests}",
                f"- Declared names: {', '.join(f'`{item}`' for item in package['names']) or 'none parsed'}",
                f"- Scripts: {', '.join(f'`{item}`' for item in package['scripts']) or 'none parsed'}",
                f"- Declared dependencies: {', '.join(f'`{item}`' for item in package['dependencies']) or 'none parsed'}",
                f"- Stack signals: {', '.join(f'`{item}`' for item in package['stack_signals']) or 'none'}",
                f"- Manifest entrypoints: {', '.join(f'`{item}`' for item in package['entrypoints']) or 'none parsed'}",
                f"- Representative first-party source: {', '.join(f'`{item['path']}`' for item in package['representative_sources']) or 'none found'}",
                f"- Applicable instructions: {', '.join(f'`{item}`' for item in package['applicable_instructions']) or 'none found'}",
                "",
            ])
    else:
        lines.extend(["No recognized package manifests were found.", ""])
    lines.extend(["## Project instructions and workspace evidence", ""])
    lines.extend(f"- `{item['path']}` — {item['read_status']} ({item.get('sha256', item.get('reason', ''))})" for item in value["rule_files"])
    lines.extend(f"- Workspace: `{item['owner']}` declares `{item['pattern']}`" for item in value["workspace_declarations"])
    lines.extend(f"- Workspace file: `{item['path']}` ({item['status']})" for item in value["workspace_files"])
    lines.extend(f"- Lockfile: `{item['path']}` ({item['status']})" for item in value["lockfiles"])
    lines.extend(["", "## Excluded paths and limitations", ""])
    lines.extend(f"- `{item['path']}` — {item['category']}: {item['reason']}" for item in value["exclusions"])
    lines.extend(f"- {item}" for item in value["limitations"])
    lines.append("")
    body = "\n".join(lines)
    marker = f"<!-- spec-harness-index:v1 sha256={hashlib.sha256(body.encode('utf-8')).hexdigest()} -->\n"
    return (body + marker).encode("utf-8")


def valid_markdown_bytes(data):
    match = re.search(rb"<!-- spec-harness-index:v1 sha256=([0-9a-f]{64}) -->\n$", data)
    return bool(match and hashlib.sha256(data[:match.start()]).hexdigest().encode("ascii") == match.group(1))


ai_rules = os.path.join(root, "ai_rules")
try:
    ai_info = os.lstat(ai_rules)
    if not stat.S_ISDIR(ai_info.st_mode) or stat.S_ISLNK(ai_info.st_mode):
        raise SystemExit("refusing to write: ai_rules exists but is not a real directory inside the selected root")
except FileNotFoundError:
    ai_info = None

map_path = os.path.join(ai_rules, "context_map.md")
inventory_path = os.path.join(ai_rules, "project_inventory.json")
map_state = "missing"
map_preimage = None
map_bytes = None
map_identity = None
map_link_target = None
if os.path.lexists(map_path):
    map_info = os.lstat(map_path)
    map_identity = (map_info.st_dev, map_info.st_ino, map_info.st_mode)
    if stat.S_ISREG(map_info.st_mode):
        map_bytes, map_error = read_bounded(map_path, MAX_OUTPUT_BYTES)
        if map_error:
            map_state = "custom"
        else:
            map_state = "generated" if valid_markdown_bytes(map_bytes) else "custom"
        map_preimage = hashlib.sha256(map_bytes).hexdigest() if map_bytes is not None else None
    else:
        map_state = "custom"
        if stat.S_ISLNK(map_info.st_mode):
            map_link_target = os.readlink(map_path)

use_json = map_state == "custom"
output_path = inventory_path if use_json else map_path
output_bytes = (json.dumps(inventory_document(inventory), ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8") if use_json else markdown_for(inventory)
if len(output_bytes) > MAX_OUTPUT_BYTES:
    raise SystemExit(f"refusing to write: generated inventory exceeds {MAX_OUTPUT_BYTES} bytes")
output_existing = None
if os.path.lexists(output_path):
    info = os.lstat(output_path)
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise SystemExit(f"refusing to write: output path is not a regular file: {rel(output_path)}")
    output_existing, error = read_bounded(output_path, MAX_OUTPUT_BYTES)
    if error:
        raise SystemExit(f"refusing to write: existing output cannot be safely read ({error}): {rel(output_path)}")
    if use_json and not valid_inventory_bytes(output_existing):
        raise SystemExit(f"refusing to overwrite customized inventory: {rel(output_path)}")
    if not use_json and not valid_markdown_bytes(output_existing):
        raise SystemExit(f"refusing to overwrite customized map: {rel(output_path)}")
    if use_json and map_state == "custom" and map_preimage is None and stat.S_ISREG(os.lstat(map_path).st_mode):
        raise SystemExit("refusing to route around an unreadable customized map")

if ai_info is None:
    try:
        os.mkdir(ai_rules, 0o755)
    except FileExistsError:
        raise SystemExit("refusing to write: ai_rules appeared during inventory")

# Recheck the selected output and directory immediately before the atomic replacement.
try:
    current_ai = os.lstat(ai_rules)
    if not stat.S_ISDIR(current_ai.st_mode) or stat.S_ISLNK(current_ai.st_mode):
        raise SystemExit("refusing to write: ai_rules changed during inventory")
    if ai_info is not None and (current_ai.st_dev, current_ai.st_ino) != (ai_info.st_dev, ai_info.st_ino):
        raise SystemExit("refusing to write: ai_rules changed during inventory")
except OSError as error:
    raise SystemExit(f"refusing to write: ai_rules changed during inventory ({error.__class__.__name__})")

if os.path.lexists(output_path):
    current_info = os.lstat(output_path)
    if not stat.S_ISREG(current_info.st_mode) or stat.S_ISLNK(current_info.st_mode):
        raise SystemExit(f"refusing to write: output path changed during inventory: {rel(output_path)}")
    current_bytes, error = read_bounded(output_path, MAX_OUTPUT_BYTES)
    if error or hashlib.sha256(current_bytes).hexdigest() != hashlib.sha256(output_existing).hexdigest():
        raise SystemExit(f"refusing to overwrite concurrent edits: {rel(output_path)}")
else:
    if output_existing is not None:
        raise SystemExit(f"refusing to overwrite concurrent edits: {rel(output_path)}")

if map_state == "custom":
    try:
        current_map_info = os.lstat(map_path)
        if (current_map_info.st_dev, current_map_info.st_ino, current_map_info.st_mode) != map_identity:
            raise SystemExit("refusing to route around a context map changed during inventory")
        if stat.S_ISREG(current_map_info.st_mode):
            current_map, error = read_bounded(map_path, MAX_OUTPUT_BYTES)
            if error or hashlib.sha256(current_map).hexdigest() != map_preimage:
                raise SystemExit("refusing to route around a context map changed during inventory")
        elif stat.S_ISLNK(current_map_info.st_mode) and os.readlink(map_path) != map_link_target:
            raise SystemExit("refusing to route around a context map changed during inventory")
    except OSError:
        raise SystemExit("refusing to route around a context map changed during inventory")

directory_fd = os.open(ai_rules, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
temporary_name = f".sh-index-{os.urandom(8).hex()}.tmp"
try:
    fd = os.open(temporary_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o644, dir_fd=directory_fd)
    try:
        offset = 0
        while offset < len(output_bytes):
            offset += os.write(fd, output_bytes[offset:])
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(temporary_name, os.path.basename(output_path), src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
    os.fsync(directory_fd)
finally:
    try:
        os.unlink(temporary_name, dir_fd=directory_fd)
    except FileNotFoundError:
        pass
    os.close(directory_fd)

print(f"Indexed {len(inventory['packages'])} package boundary/boundaries; {len(instruction_rows)} instruction files; {len(inventory['exclusions'])} excluded paths.")
print(f"Wrote: {rel(output_path)}")
if use_json:
    print("Existing context_map.md was preserved; read ai_rules/project_inventory.json for this scan.")
else:
    print("Next: have the researcher read these project facts and derive any stack-specific guidance.")
PY
