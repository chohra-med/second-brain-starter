"""status, update and uninstall for a target that has Spec Harness installed. No network.

status    : the installed version and commit (from .spec-harness/install.json), the version and commit
            of this checkout, and whether an update would change anything.
update    : plan, then apply. Without --apply it prints one state per planned file and a plan digest;
            `--apply <digest>` applies exactly that plan and refuses a different one.
              UNCHANGED         the target already has the current harness bytes
              UPDATE            the target still has the bytes this harness installed; the template changed
              CUSTOMIZED-KEEP   edited locally (or not installed by the harness); the template is unchanged,
                                or the file is a synthesis output; kept as it is
              MERGE             edited locally and the template changed; a clean three-way merge with the
                                stored base copy
              CONFLICT          the three-way merge conflicts: <file>.spec-harness-proposed is written for
                                that path only and the file itself is left alone
              NEW               a new harness file; added
              REMOVED-UPSTREAM  the harness no longer ships it; listed only, never deleted
            Synthesis outputs named by the receipt are never written. After an apply that wrote a file and
            a receipt exists, synthesis is marked stale (the marker is written before the first write) so
            `generate-agents --check` refuses READY until init removes the marker.
uninstall : plan only. Lists exactly what the install record says the harness wrote, and which of
            those files were edited since. It deletes nothing.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from sh_safe_io import MAX_FILE_BYTES, MAX_RECEIPT_BYTES, SafeReadError, WriteRefused, load_json_object, read_bounded, safe_relative, write_regular  # noqa: E402

HARNESS = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
STATE = ".spec-harness"
RECORD = STATE + "/install.json"
STALE = STATE + "/synthesis-stale.json"
RECEIPT = ".claude/agents/.init-synthesis.json"
PROPOSED = ".spec-harness-proposed"
ACTIONABLE = {"UPDATE", "MERGE", "NEW", "CONFLICT"}


class Refused(Exception):
    pass


def sha(data):
    return hashlib.sha256(data).hexdigest()


def user_owned(files, rel):
    """A record entry the install wrote as the user's own file (managed: false). Update never adopts it."""
    return rel in files and not files[rel].get("managed")


def write_or_refuse(root, rel, data, executable=False):
    """write_regular, with an OS failure (a read-only directory, a full disk) named as a refusal."""
    try:
        write_regular(root, rel, data, executable)
    except OSError as error:
        raise Refused(f"cannot write {rel}: {error.strerror or error}") from None


def read_optional(root, rel, limit=MAX_FILE_BYTES):
    """Bytes of a regular in-root file, None when missing; Refused for a link, FIFO or oversize."""
    try:
        return read_bounded(rel, limit, root=root)
    except SafeReadError as error:
        if error.reason == "missing":
            return None
        raise Refused(str(error)) from None


def load_record(root):
    if read_optional(root, RECORD, 4 * 1024 * 1024) is None:
        return None
    try:
        record = load_json_object(RECORD, 4 * 1024 * 1024, root=root, what="install record")
    except SafeReadError as error:
        raise Refused(str(error)) from None
    if record.get("format") != "spec-harness-install-record" or not isinstance(record.get("files"), dict):
        raise Refused(f"{RECORD} is not a Spec Harness install record")
    for rel, row in record["files"].items():
        if not safe_relative(rel) or not isinstance(row, dict):
            raise Refused(f"{RECORD} has an unsafe or malformed entry: {rel!r}")
    return record


def source_identity():
    version = json.load(open(os.path.join(HARNESS, "package.json"), encoding="utf-8")).get("version")
    commit, dirty = None, None
    if os.path.exists(os.path.join(HARNESS, ".git")) and shutil.which("git"):
        result = subprocess.run(["git", "-C", HARNESS, "rev-parse", "HEAD"], capture_output=True, text=True)
        commit = result.stdout.strip() or None if result.returncode == 0 else None
        status = subprocess.run(["git", "-C", HARNESS, "status", "--porcelain"], capture_output=True, text=True)
        dirty = bool(status.stdout.strip()) if status.returncode == 0 else None
    return version, commit, dirty


def render_plan(name):
    """The bytes the current checkout would install, rendered by the installer itself."""
    out = tempfile.mkdtemp(prefix="spec-harness-update.")
    result = subprocess.run(["bash", os.path.join(HARNESS, "bin/sh-install.sh"), "--render-plan", out, name],
                            capture_output=True, text=True)
    if result.returncode:
        shutil.rmtree(out, ignore_errors=True)
        raise Refused("could not render the harness file set: " + (result.stderr or result.stdout).strip())
    with open(os.path.join(out, ".plan-list"), encoding="utf-8") as handle:
        rels = [line.rstrip("\n") for line in handle if line.strip()]
    planned = {}
    for rel in rels:
        with open(os.path.join(out, rel), "rb") as handle:
            planned[rel] = (handle.read(), bool(os.stat(os.path.join(out, rel)).st_mode & 0o111))
    shutil.rmtree(out, ignore_errors=True)
    return planned


def load_migrations():
    path = os.path.join(HARNESS, "install-migrations.tsv")
    rows = []
    if not os.path.isfile(path):
        return rows
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if not line.strip() or line.startswith("#"):
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3 or not safe_relative(parts[0]) or not safe_relative(parts[1]):
                raise Refused(f"install-migrations.tsv has a malformed row: {line.strip()!r}")
            rows.append({"from": parts[0], "to": parts[1], "since": parts[2]})
    return rows


def synthesis_outputs(root):
    """Paths the synthesis receipt owns. They are never written by update."""
    try:
        receipt = load_json_object(RECEIPT, MAX_RECEIPT_BYTES, root=root, what="receipt")
    except SafeReadError:
        return set()
    owned = set()
    for row in receipt.get("packages", []) if isinstance(receipt.get("packages"), list) else []:
        if isinstance(row, dict):
            owned.add(row.get("rules_path"))
            for module in row.get("rule_modules", []) if isinstance(row.get("rule_modules"), list) else []:
                if isinstance(module, dict):
                    owned.add(module.get("path"))
    for key in ("skills", "roles"):
        for row in receipt.get(key, []) if isinstance(receipt.get(key), list) else []:
            if isinstance(row, dict):
                owned.add(row.get("path"))
    return {path for path in owned if isinstance(path, str)}


def merge3(local, base, theirs):
    """git merge-file: (merged bytes, conflict count). Works outside a repository."""
    work = tempfile.mkdtemp(prefix="spec-harness-merge.")
    try:
        paths = []
        for label, data in (("local", local), ("base", base), ("harness", theirs)):
            path = os.path.join(work, label)
            with open(path, "wb") as handle:
                handle.write(data)
            paths.append(path)
        result = subprocess.run(["git", "merge-file", "-p", "-L", "local", "-L", "base", "-L", "harness", *paths],
                                capture_output=True)
        if result.returncode < 0 or result.returncode > 127:
            raise Refused(f"git merge-file failed (exit {result.returncode}): " + result.stderr.decode("utf-8", "replace"))
        return result.stdout, result.returncode
    finally:
        shutil.rmtree(work, ignore_errors=True)


def build_plan(root, name_override=None):
    record = load_record(root)
    files = record["files"] if record else {}
    name = name_override or (record or {}).get("project_name") or os.path.basename(root)
    planned = render_plan(name)
    owned = synthesis_outputs(root)
    migrations = load_migrations()
    renamed_to = {row["from"]: row["to"] for row in migrations}
    renamed_from = {row["to"]: row["from"] for row in migrations}
    rows = []
    for rel in sorted(planned):
        new, executable = planned[rel]
        disk = read_optional(root, rel)
        entry = files.get(rel)
        managed = bool(entry and entry.get("managed"))
        row = {"path": rel, "new_sha256": sha(new), "disk_sha256": sha(disk) if disk is not None else None,
               "note": "", "_new": new, "_executable": executable}
        if rel in renamed_from:
            row["note"] = f"renamed from {renamed_from[rel]}"
        if rel in owned:
            row["state"] = "UNCHANGED" if disk == new else "CUSTOMIZED-KEEP"
            if disk != new:
                row["note"] = "synthesis output; refresh it through init, not update"
        elif disk is None:
            if managed:
                row.update(state="CUSTOMIZED-KEEP", note="deleted locally; not restored")
            elif entry is not None:
                row.update(state="CUSTOMIZED-KEEP", note="your file from before the install; deleted locally, not restored")
            else:
                row["state"] = "NEW"
        elif disk == new:
            row["state"] = "UNCHANGED"
        elif managed and sha(disk) == entry.get("sha256"):
            row["state"] = "UPDATE"
        elif managed:
            base = read_optional(root, f"{STATE}/base/{rel}")
            if base is not None and sha(base) == entry.get("sha256") and base == new:
                row["state"] = "CUSTOMIZED-KEEP"
            elif base is not None and sha(base) == entry.get("sha256"):
                merged, conflicts = merge3(disk, base, new)
                if conflicts:
                    row.update(state="CONFLICT", _merged=merged, merged_sha256=sha(merged),
                               note=f"{conflicts} conflicting hunk(s); see {rel}{PROPOSED}")
                else:
                    row.update(state="MERGE", _merged=merged, merged_sha256=sha(merged))
            else:
                row.update(state="CONFLICT", _merged=new, merged_sha256=sha(new),
                           note=f"no valid base copy to merge with; the new harness version is in {rel}{PROPOSED}")
        elif record is None:
            row.update(state="CUSTOMIZED-KEEP", note="no install record: a local edit cannot be told from an older template")
        else:
            row.update(state="CUSTOMIZED-KEEP", note="your file from before the install; not managed by the harness")
        rows.append(row)
    for rel in sorted(set(files) - set(planned)):
        if files[rel].get("managed"):
            note = f"renamed to {renamed_to[rel]}" if rel in renamed_to else "no longer shipped"
            rows.append({"path": rel, "state": "REMOVED-UPSTREAM", "note": note + "; kept, never deleted automatically",
                         "new_sha256": None, "disk_sha256": sha(d) if (d := read_optional(root, rel)) is not None else None})
    digest_rows = [[row["path"], row["state"], row.get("disk_sha256"), row.get("new_sha256"), row.get("merged_sha256")] for row in rows]
    digest = sha(json.dumps({"name": name, "rows": digest_rows}, sort_keys=True, separators=(",", ":")).encode())
    return record, name, rows, digest


def print_plan(root, record, rows, digest):
    version, commit, _ = source_identity()
    installed = (record or {}).get("harness_version") or "unknown (no install record)"
    print("Spec Harness update plan (nothing was written)")
    print(f"  target    : {root}")
    print(f"  installed : {installed}")
    print(f"  source    : {version}{' @ ' + commit[:12] if commit else ''}")
    width = max(len(row["state"]) for row in rows) if rows else 0
    for row in rows:
        note = f"  ({row['note']})" if row.get("note") else ""
        print(f"  {row['state']:<{width}}  {row['path']}{note}")
    counts = {}
    for row in rows:
        counts[row["state"]] = counts.get(row["state"], 0) + 1
    print("  summary   : " + ", ".join(f"{state} {count}" for state, count in sorted(counts.items())))
    print(f"PLAN DIGEST: {digest}")
    if any(row["state"] in ACTIONABLE for row in rows):
        print(f"Apply exactly this plan with: spec-harness update <target> --apply {digest}")
    else:
        print("Nothing to apply.")


def write_stale_marker(root, version, receipt, paths):
    stale = {"format": "spec-harness-synthesis-stale", "schema_version": 1,
             "reason": "a harness update changed installed files after synthesis",
             "harness_version": version, "receipt_sha256": sha(receipt), "paths": paths}
    write_or_refuse(root, STALE, (json.dumps(stale, indent=2, sort_keys=True) + "\n").encode())


def apply_plan(root, record, name, rows, digest):
    receipt = read_optional(root, RECEIPT, MAX_RECEIPT_BYTES)
    files = dict((record or {}).get("files", {}))
    owned = synthesis_outputs(root)
    version, commit, dirty = source_identity()
    # No receipt means nothing was synthesised, so nothing can be stale: no marker. With a receipt, the
    # marker is written before the first file write, so a write that fails partway leaves it behind.
    marked = receipt is not None and any(row["state"] in {"UPDATE", "NEW", "MERGE"} for row in rows)
    if marked:
        write_stale_marker(root, version, receipt, [row["path"] for row in rows if row["state"] in {"UPDATE", "NEW", "MERGE"}])
    written, proposed = [], []
    for row in rows:
        rel, state = row["path"], row["state"]
        if state in {"UPDATE", "NEW"}:
            write_or_refuse(root, rel, row["_new"], row["_executable"])
            written.append(rel)
        elif state == "MERGE":
            write_or_refuse(root, rel, row["_merged"], row["_executable"])
            written.append(rel)
        elif state == "CONFLICT":
            write_or_refuse(root, rel + PROPOSED, row["_merged"])
            proposed.append(rel + PROPOSED)
            continue
        elif state == "UNCHANGED" and rel not in owned and not user_owned(files, rel):
            pass  # adopt: record the current harness bytes (an install without a record gains one)
        else:
            continue
        # The record and base copy always hold the pristine harness bytes; a merged file therefore
        # stays "edited locally" for the next update.
        write_or_refuse(root, f"{STATE}/base/{rel}", row["_new"])
        files[rel] = {"managed": True, "sha256": row["new_sha256"]}
    record = dict(record or {"format": "spec-harness-install-record", "schema_version": 1, "project_name": name})
    record.update({"harness_version": version, "harness_commit": commit, "files": dict(sorted(files.items()))})
    if dirty:
        record["harness_commit_dirty"] = True
    else:
        record.pop("harness_commit_dirty", None)
    write_or_refuse(root, RECORD, (json.dumps(record, indent=2, sort_keys=True) + "\n").encode())
    if marked:
        write_stale_marker(root, version, receipt, written)
    print(f"UPDATED: {len(written)} file(s) written, {len(proposed)} proposal(s) written; plan {digest[:12]}")
    for path in proposed:
        print(f"  CONFLICT: resolve {path} by hand; the file it proposes for was left as it was")
    if marked:
        print(f"  synthesis is now marked stale ({STALE}); run /sdd init (guarded refresh), which removes the marker, then generate-agents --check")
    return 0


def status(root):
    record = load_record(root)
    version, commit, dirty = source_identity()
    _, _, rows, _ = build_plan(root)
    counts = {}
    for row in rows:
        counts[row["state"]] = counts.get(row["state"], 0) + 1
    available = any(row["state"] in ACTIONABLE or row["state"] == "REMOVED-UPSTREAM" for row in rows)
    print("Spec Harness status")
    print(f"  target            : {root}")
    if record:
        installed_commit = record.get("harness_commit")
        print(f"  installed version : {record.get('harness_version')}")
        print(f"  installed commit  : {installed_commit or 'unknown'}{' (checkout had local changes)' if record.get('harness_commit_dirty') else ''}")
    else:
        print("  installed version : unknown (no .spec-harness/install.json; installed before 0.4.0)")
    print(f"  source version    : {version}")
    print(f"  source commit     : {commit or 'unknown (not a git checkout)'}{' (with local changes)' if dirty else ''}")
    print("  files             : " + ", ".join(f"{state} {count}" for state, count in sorted(counts.items())))
    stale = read_optional(root, STALE, 64 * 1024)
    if stale is not None:
        print(f"  synthesis         : marked stale by an update ({STALE}); refresh it through init")
    print(f"  update available  : {'yes' if available else 'no'}")
    if available:
        print("Next: spec-harness update <target>   (prints the plan and its digest; nothing is written)")
    return 0


def uninstall(root):
    record = load_record(root)
    if record is None:
        raise Refused("no .spec-harness/install.json: this install predates 0.4.0, so what it wrote cannot be listed exactly; use the branch you installed on, or `git status` in the target")
    print("Spec Harness uninstall plan (plan only: nothing is deleted)")
    print(f"  target : {root}")
    kept, removable, edited, missing = [], [], [], []
    for rel, row in sorted(record["files"].items()):
        if not row.get("managed"):
            kept.append(rel)
            continue
        disk = read_optional(root, rel)
        if disk is None:
            missing.append(rel)
        elif sha(disk) == row.get("sha256"):
            removable.append(rel)
        else:
            edited.append(rel)
    for label, items in (("UNCHANGED since install (safe to delete)", removable),
                         ("EDITED since install (review before deleting)", edited),
                         ("ALREADY GONE", missing),
                         ("YOURS before install (never delete)", kept)):
        print(f"  {label}: {len(items)}")
        for rel in items:
            print(f"    - {rel}")
    print(f"  then delete the harness state directory: {STATE}/")
    print("Generated synthesis outputs (rules, skills, role bindings, receipt) are listed by the receipt, not by this record.")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="spec-harness", description="status, update and uninstall (plan only)")
    parser.add_argument("command", choices=["status", "update", "uninstall"])
    parser.add_argument("target")
    parser.add_argument("--apply", metavar="DIGEST", help="apply the plan whose digest `update` printed")
    parser.add_argument("--name", help="project name to render templates with (default: the install record)")
    args = parser.parse_args(argv)
    selected = os.path.abspath(os.path.expanduser(args.target))
    if not os.path.isdir(selected) or os.path.islink(selected):
        raise Refused("select an existing target directory, not a symbolic link")
    root = os.path.realpath(selected)
    if os.path.realpath(HARNESS) == root:
        raise Refused("the target is this harness checkout; select the project it was installed into")
    if args.command == "status":
        return status(root)
    if args.command == "uninstall":
        return uninstall(root)
    record, name, rows, digest = build_plan(root, args.name)
    if not args.apply:
        print_plan(root, record, rows, digest)
        return 0
    if not re.fullmatch(r"[0-9a-f]{64}", args.apply) or args.apply != digest:
        raise Refused("the plan digest does not match the current plan; run `spec-harness update <target>` again and review it")
    return apply_plan(root, record, name, rows, digest)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (Refused, WriteRefused) as error:
        print(f"PENDING: {error}", file=sys.stderr)
        sys.exit(1)
