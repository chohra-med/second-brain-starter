#!/usr/bin/env python3
"""Structural check of a saved pull request body. Standard library only, read-only.

A PASS here checks the packet's shape and a few mechanical facts. It does not prove that the
claims in the text are true; the reviewer compares every claim with the evidence.

Usage (through the dispatcher, which runs it with python3 -I -B):
  spec-harness pr-packet PR_BODY.md [--test-names FILE]
  spec-harness pr-packet PR_BODY.md --repo DIR --base REF --head REF

  --test-names FILE  one real test name per line, copied from the branch's test diff. Each name
                     must appear verbatim in the body.
  --repo DIR         git repo to read. With --base and --head, test names are collected from
                     `git diff BASE...HEAD` (added lines only) in test files: *.test.*, *.spec.*,
                     test_*.py (any depth). Read-only, no fetch. Combined with --test-names when
                     both are given.
  --base REF         base ref for the diff (required with --repo)
  --head REF         head ref for the diff (required with --repo)

Output: one line per check, "PASS|FAIL|UNVERIFIED name: detail". Exit 0 when no check FAILs,
1 when any check FAILs, 2 for a usage or read error.
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

REQUIRED_SECTIONS = ("summary", "evidence")
OPTIONAL_SECTIONS = ("merge danger",)
MAX_MERGE_DANGER_BULLETS = 3
VIDEO_PATTERN = re.compile(r"\.(mp4|mov|webm|m4v)\b|<video\b", re.IGNORECASE)
IMAGE_PATTERN = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)|<img\b[^>]*>", re.IGNORECASE)
ABSOLUTE_PATH_PATTERN = re.compile(r"(?<![\w.])(/(?:Users|home)/|[A-Za-z]:\\)")
PLACEHOLDER_PATTERN = re.compile(r"\b(TODO|TBD|lorem ipsum)\b|<placeholder>", re.IGNORECASE)
HEADING_PATTERN = re.compile(r"^#{1,6}\s+(.*?)\s*#*\s*$")
FENCE_PATTERN = re.compile(r"^\s*(```|~~~)")
TEST_PATHSPECS = ("*.test.*", "*.spec.*", "test_*.py", "*/test_*.py")
JS_TEST_RE = re.compile(r"""\b(?:it|test|describe)(?:\.(?:only|skip))?\(\s*(['"`])(.+?)\1""")
PY_TEST_RE = re.compile(r"^\s*(?:async\s+)?def\s+(test_\w+)")


def added_test_titles(repo, base, head):
    """Return test titles added in `git diff base...head` within TEST_PATHSPECS (read-only git)."""
    for ref in (base, head):
        if ref.startswith("-"):
            raise ValueError("ref must not start with '-': %s" % ref)
    cmd = ["git", "-C", repo, "diff", "--no-color", "--no-ext-diff", "--unified=0",
           "%s...%s" % (base, head), "--", *TEST_PATHSPECS]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "git diff failed")
    titles = []
    for line in proc.stdout.splitlines():
        if not line.startswith("+") or line.startswith("+++"):
            continue
        body = line[1:]
        match = JS_TEST_RE.search(body)
        name = match.group(2) if match else None
        if name is None:
            match = PY_TEST_RE.match(body)
            name = match.group(1) if match else None
        if name and name not in titles:
            titles.append(name)
    return titles


def split_sections(text):
    """Return {lowercase heading: body lines}. Text before the first heading is ignored.

    A line inside a fenced code block is body text, so a shell comment such as `# run the suite` is not a heading.
    """
    sections = {}
    current = None
    in_fence = False
    for line in text.splitlines():
        if FENCE_PATTERN.match(line):
            in_fence = not in_fence
            if current is not None:
                sections[current].append(line)
            continue
        match = None if in_fence else HEADING_PATTERN.match(line)
        if match:
            current = match.group(1).strip().lower()
            sections.setdefault(current, [])
        elif current is not None:
            sections[current].append(line)
    return sections


def bullets(lines):
    return [line for line in lines if re.match(r"^\s*([-*+]|\d+[.)])\s+", line)]


def main(argv):
    parser = argparse.ArgumentParser(prog="spec-harness pr-packet", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("body", help="path to the saved PR body (Markdown)")
    parser.add_argument("--test-names", help="file with one real test name per line")
    parser.add_argument("--repo", help="git repo to collect test names from (needs --base and --head)")
    parser.add_argument("--base", help="base ref for the test diff (with --repo)")
    parser.add_argument("--head", help="head ref for the test diff (with --repo)")
    args = parser.parse_args(argv)
    if args.repo and not (args.base and args.head):
        parser.error("--repo needs both --base and --head")
    if (args.base or args.head) and not args.repo:
        parser.error("--base and --head need --repo")

    try:
        text = Path(args.body).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        print("FAIL read: cannot read %s (%s)" % (args.body, getattr(exc, "strerror", None) or "not UTF-8 text"))
        return 2

    results = []
    sections = split_sections(text)

    for name in REQUIRED_SECTIONS:
        if name in sections:
            results.append(("PASS", "section %s" % name, "present"))
        else:
            results.append(("FAIL", "section %s" % name, "missing heading"))

    if "merge danger" in sections:
        count = len(bullets(sections["merge danger"]))
        if count <= MAX_MERGE_DANGER_BULLETS:
            results.append(("PASS", "merge danger bullets", "%d (max %d)" % (count, MAX_MERGE_DANGER_BULLETS)))
        else:
            results.append(("FAIL", "merge danger bullets", "%d, max %d" % (count, MAX_MERGE_DANGER_BULLETS)))

    evidence_lines = sections.get("evidence", [])
    images = [match.group(0) for match in IMAGE_PATTERN.finditer("\n".join(evidence_lines))]
    if len(images) == 1:
        results.append(("PASS", "evidence image count", "1 combined image"))
    else:
        results.append(("FAIL", "evidence image count", "%d found, expected exactly 1 combined Before/After image" % len(images)))
    if images:
        lowered = images[0].lower()
        if "before" in lowered and "after" in lowered:
            results.append(("PASS", "before/after labels", "alt text or path names both"))
        else:
            results.append(("FAIL", "before/after labels", "image alt text or path must name Before and After"))

    if VIDEO_PATTERN.search(text):
        results.append(("FAIL", "no video", "a video reference was found"))
    else:
        results.append(("PASS", "no video", "none"))

    absolute = ABSOLUTE_PATH_PATTERN.findall(text)
    if absolute:
        results.append(("FAIL", "no private paths", "%d absolute local path(s) in public text" % len(absolute)))
    else:
        results.append(("PASS", "no private paths", "none"))

    placeholders = PLACEHOLDER_PATTERN.findall(text)
    if placeholders:
        results.append(("FAIL", "no placeholders", "%d placeholder(s) left" % len(placeholders)))
    else:
        results.append(("PASS", "no placeholders", "none"))

    if args.test_names or args.repo:
        names = []
        if args.test_names:
            try:
                names = [line.strip() for line in Path(args.test_names).read_text(encoding="utf-8").splitlines() if line.strip()]
            except (OSError, UnicodeDecodeError) as exc:
                print("FAIL read: cannot read %s (%s)" % (args.test_names, getattr(exc, "strerror", None) or "not UTF-8 text"))
                return 2
            if not names:
                results.append(("FAIL", "test names", "test-names file is empty"))
        if args.repo:
            try:
                derived = added_test_titles(args.repo, args.base, args.head)
            except (OSError, RuntimeError, ValueError) as exc:
                print("FAIL read: cannot read test diff %s...%s in %s (%s)" % (args.base, args.head, args.repo, exc))
                return 2
            if not derived and not names:
                results.append(("UNVERIFIED", "test names", "no added test titles in %s...%s under test globs" % (args.base, args.head)))
            names += [name for name in derived if name not in names]
        missing = [name for name in names if name not in text]
        if missing:
            results.append(("FAIL", "test names", "not found verbatim in body: " + "; ".join(missing)))
        elif names:
            results.append(("PASS", "test names", "%d verbatim" % len(names)))
    else:
        results.append(("UNVERIFIED", "test names", "no --test-names file given"))

    results.append(("UNVERIFIED", "claims vs evidence", "not checked by this script; reviewer must compare each claim"))
    results.append(("UNVERIFIED", "before source", "not checked; confirm the Before was a real base-branch run"))

    for status, name, detail in results:
        print("%s %s: %s" % (status, name, detail))

    return 1 if any(status == "FAIL" for status, _, _ in results) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
