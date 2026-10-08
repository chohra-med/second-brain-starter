#!/usr/bin/env bash
# Conformance: a real bin/sh-install.sh run stages exactly what install-manifest.json describes.
# The checker renders every manifest entry itself and compares it to the bytes the installer
# produced. It never reads the installer's own plan. No fixture writes outside TMPDIR.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HARNESS_DIR="${SPEC_HARNESS_DIR:-$(cd "$TEST_DIR/.." && pwd -P)}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/spec-harness-manifest.XXXXXX")" || exit 1
FAILURES=0

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

pass() { printf 'PASS: %s\n' "$1"; }

if ! command -v python3 >/dev/null 2>&1; then
  printf 'SKIPPED: python3 is required\n'
  exit 1
fi

CHECKER="$TMP/checker.py"
cat >"$CHECKER" <<'PYEOF'
import hashlib, json, os, re, shutil, stat, subprocess, sys

def sha(b):
    return hashlib.sha256(b).hexdigest()

def render(src_bytes, tokens, table, name):
    """Literal, single-pass replacement per line; output always ends in one LF."""
    lines = src_bytes.split(b"\n")
    if lines and lines[-1] == b"":
        lines.pop()
    out = []
    for line in lines:
        for tok in tokens:
            value = table[tok].replace("{name}", name).encode("utf-8")
            line = line.replace(tok.encode("utf-8"), value)
        out.append(line + b"\n")
    return b"".join(out)

def walk(target):
    files, dirs = set(), set()
    for dp, dn, fn in os.walk(target):
        dn[:] = [d for d in dn if d != ".git"]
        for d in dn:
            dirs.add(os.path.relpath(os.path.join(dp, d), target))
        for f in fn:
            files.add(os.path.relpath(os.path.join(dp, f), target))
    return files, dirs

def ancestors(rel):
    parts = rel.split("/")
    return {"/".join(parts[:i]) for i in range(1, len(parts))}

def loader_block(root):
    text = open(os.path.join(root, "docs/GETTING-STARTED.md"), encoding="utf-8").read()
    m = re.search(r"```markdown\n(.*?)```", text, re.S)
    return m.group(1) if m else None

def check(manifest, root, target, name):
    bad = []
    if manifest.get("schemaVersion") != 1:
        bad.append("schemaVersion is not 1")
    pkg = json.load(open(os.path.join(root, "package.json")))
    if manifest.get("harnessVersion") != pkg["version"]:
        bad.append("harnessVersion %s != package.json %s" % (manifest.get("harnessVersion"), pkg["version"]))
    table = manifest["substitutions"]["tokens"]
    entries = manifest["entries"]
    want = {e["destination"] for e in entries}
    files, dirs = walk(target)
    for p in sorted(files - want):
        bad.append("EXTRA installed path not in manifest: " + p)
    for p in sorted(want - files):
        bad.append("MISSING manifest path not installed: " + p)
    for e in entries:
        d, s = e["destination"], e["source"]
        sp = os.path.join(root, s)
        if not os.path.isfile(sp):
            bad.append("SOURCE missing for %s: %s" % (d, s))
            continue
        src = open(sp, "rb").read()
        if sha(src) != e["sha256"]:
            bad.append("SOURCE HASH mismatch for %s: %s" % (d, s))
        if e["render"] == "copy":
            if e["tokens"]:
                bad.append("copy entry lists tokens: " + d)
            expect = src
        elif e["render"] == "template":
            expect = render(src, e["tokens"], table, name)
        else:
            bad.append("unknown render for %s: %s" % (d, e["render"]))
            continue
        ip = os.path.join(target, d)
        if os.path.isfile(ip):
            if open(ip, "rb").read() != expect:
                bad.append("BYTES differ for installed " + d)
            installed_x = bool(stat.S_IMODE(os.stat(ip).st_mode) & 0o111)
            manifest_x = bool(int(e["mode"], 8) & 0o111)
            if installed_x != manifest_x:
                bad.append("EXECUTABLE BIT differs for %s: installed %s manifest %s" % (d, installed_x, manifest_x))
    listed = set(manifest["directories"])
    implied = set(listed)
    for p in listed | want:
        implied |= ancestors(p)
    implied |= {a for p in listed for a in ancestors(p + "/x")}
    for p in sorted(dirs - implied):
        bad.append("EXTRA directory not in manifest: " + p)
    for p in sorted(listed - dirs):
        bad.append("MISSING manifest directory not created: " + p)
    lb = loader_block(root)
    if not lb or not manifest.get("loaderBlock"):
        bad.append("LOADER BLOCK empty or absent in the manifest or in docs/GETTING-STARTED.md")
    elif lb != manifest["loaderBlock"]:
        bad.append("LOADER BLOCK differs from the fenced block in docs/GETTING-STARTED.md")
    return bad

def install(root, target, name):
    os.makedirs(target)
    subprocess.run(["git", "init", "-q", target], check=True)
    r = subprocess.run(["bash", os.path.join(root, "bin/sh-install.sh"), target, "integrate", name],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("installer rc=%d\n%s" % (r.returncode, r.stderr))

def main():
    mode, root, work, name = sys.argv[1:5]
    manifest = json.load(open(os.path.join(root, "install-manifest.json"), encoding="utf-8"))
    target = os.path.join(work, "t")
    install(root, target, name)
    if mode == "real":
        bad = check(manifest, root, target, name)
        for b in bad:
            print("FAIL: " + b)
        sys.exit(1 if bad else 0)
    # Planted-fault controls: each must turn the checker RED with the named path.
    def fresh(tag):
        w = os.path.join(work, tag)
        os.makedirs(w)
        return w
    def copy_root(tag):
        r = os.path.join(fresh(tag), "root")
        shutil.copytree(root, r, ignore=shutil.ignore_patterns(".git"))
        return r
    def m_copy():
        return json.loads(json.dumps(manifest))
    controls = []
    m = m_copy(); gone = m["entries"].pop(0)["destination"]
    controls.append(("a delete one manifest entry", check(m, root, target, name), "EXTRA installed path not in manifest: " + gone))
    m = m_copy(); m["entries"].append(dict(m["entries"][0], destination="zz/fake-entry.md"))
    controls.append(("b add a fake entry", check(m, root, target, name), "MISSING manifest path not installed: zz/fake-entry.md"))
    m = m_copy(); m["entries"][1]["sha256"] = "0" * 64; hit = m["entries"][1]["destination"]
    controls.append(("c change one sha256", check(m, root, target, name), "SOURCE HASH mismatch for " + hit))
    r = copy_root("d"); p = os.path.join(r, "templates/AGENTS.md")
    open(p, "ab").write(b"x")
    controls.append(("d edit one byte of templates/AGENTS.md", check(manifest, r, target, name), "SOURCE HASH mismatch for AGENTS.md"))
    m = m_copy(); m["substitutions"]["tokens"]["{{DIR}}"] = "{name} (planted)"
    controls.append(("e change the {{DIR}} derivation", check(m, root, target, name), "BYTES differ for installed RULES.md"))
    t2 = os.path.join(fresh("f"), "t"); install(root, t2, name); os.makedirs(os.path.join(t2, "planted-empty-dir"))
    controls.append(("f extra empty directory after install", check(manifest, root, t2, name), "EXTRA directory not in manifest: planted-empty-dir"))
    r = copy_root("g"); p = os.path.join(r, "docs/GETTING-STARTED.md")
    s = open(p, encoding="utf-8").read().replace("Keep PENDING items PENDING", "Keep PENDING items planted", 1)
    open(p, "w", encoding="utf-8").write(s)
    controls.append(("g edit one loader bullet", check(manifest, r, target, name), "LOADER BLOCK differs from the fenced block in docs/GETTING-STARTED.md"))
    t3 = os.path.join(fresh("h"), "t"); install(root, t3, name)
    os.remove(os.path.join(t3, "goal.md"))
    controls.append(("h installed file removed", check(manifest, root, t3, name), "MISSING manifest path not installed: goal.md"))
    t4 = os.path.join(fresh("i"), "t"); install(root, t4, name)
    open(os.path.join(t4, "SPEC-HARNESS.md"), "ab").write(b"x")
    controls.append(("i one installed byte changed", check(manifest, root, t4, name), "BYTES differ for installed SPEC-HARNESS.md"))
    r = copy_root("j"); p = os.path.join(r, "docs/GETTING-STARTED.md")
    s = open(p, encoding="utf-8").read().replace("```markdown", "```text", 1)
    open(p, "w", encoding="utf-8").write(s)
    m = m_copy(); m["loaderBlock"] = ""
    controls.append(("j loader block absent on both sides", check(m, r, target, name), "LOADER BLOCK empty or absent"))
    r = copy_root("k"); os.remove(os.path.join(r, "templates/install/learning/NOTES.md"))
    t5 = os.path.join(fresh("k2"), "t"); os.makedirs(t5)
    subprocess.run(["git", "init", "-q", t5], check=True)
    res = subprocess.run(["bash", os.path.join(r, "bin/sh-install.sh"), t5, "integrate", name], capture_output=True, text=True)
    staged, _ = walk(t5)
    fired = res.returncode != 0 and "missing installer source" in res.stderr and not staged
    controls.append(("k missing template source", [] if not fired else ["missing installer source: rc=%d, nothing staged" % res.returncode], "missing installer source: rc="))
    ok = True
    for label, bad, needle in controls:
        if any(b.startswith(needle) for b in bad):
            print("RED control observed: %s -> %s" % (label, needle))
        else:
            ok = False
            print("FAIL: control %s did not produce: %s (got %s)" % (label, needle, bad))
    sys.exit(0 if ok else 1)

main()
PYEOF

# Names exercise shell metacharacters, a token inside the name, and a plain name.
NAMES=('Demo $(touch SHOULD_NOT_EXIST) & Co' 'X{{PROJECT_NAME}}Y' 'plain-name' '{{DIR}} edge' 'A$&B$$C')
i=0
for NAME in "${NAMES[@]}"; do
  i=$((i + 1))
  work="$TMP/real$i"
  mkdir -p "$work"
  if python3 -I "$CHECKER" real "$HARNESS_DIR" "$work" "$NAME" >"$TMP/real$i.log" 2>&1; then
    pass "installed set equals manifest, bytes and modes match (name case $i)"
  else
    cat "$TMP/real$i.log"
    fail "installed set differs from manifest (name case $i)"
  fi
  if [ -e "$work/t/SHOULD_NOT_EXIST" ]; then fail "name was executed as shell (name case $i)"; fi
done

work="$TMP/controls"
mkdir -p "$work"
if python3 -I "$CHECKER" controls "$HARNESS_DIR" "$work" 'plain-name' >"$TMP/controls.log" 2>&1; then
  cat "$TMP/controls.log"
  pass 'planted-fault controls all turn the checker red'
else
  cat "$TMP/controls.log"
  fail 'planted-fault controls'
fi

# The second run into the same target stays a no-op.
second="$TMP/second"
mkdir -p "$second"
git init -q "$second"
bash "$HARNESS_DIR/bin/sh-install.sh" "$second" integrate demo >/dev/null 2>&1
bash "$HARNESS_DIR/bin/sh-install.sh" "$second" integrate demo >"$TMP/second.log" 2>&1
rc=$?
if [ "$rc" -eq 0 ] && grep -A1 'ADDED paths:' "$TMP/second.log" | grep -q '(none)'; then
  pass 'second install exits 0 and adds nothing'
else
  fail 'second install exits 0 and adds nothing'
fi

if [ "$FAILURES" -eq 0 ]; then
  printf 'RESULT: PASS (install manifest contract)\n'
  exit 0
fi
printf 'RESULT: FAIL (%s manifest contract checks failed)\n' "$FAILURES"
exit 1
