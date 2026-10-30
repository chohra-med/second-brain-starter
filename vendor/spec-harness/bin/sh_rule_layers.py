"""Schema 4 rule-layer checks for the readiness check (bin/sh-gen-agents.sh --check).

One fact, one home:
- business rules and standard commitments (`STD-`) live in `.memory/10-product.md`, decisions in
  `.memory/60-decisions.md`;
- package versions live only in `ai_rules/stack.md` (bin/sh_stack.py);
- every rule is one line, `- **ID** sentence. (source: ...)`, written once in one rule file;
- baseline and tool modules copy curated pack lines from `templates/rule-packs/` byte for byte;
- skills and role blocks name rule IDs and link to the stack; they never copy a rule or a version.

`check(...)` reports each defect through the caller's `fail` and returns the parsed rules, so the
policy ledger can require that a captured requirement's anchor is a rule ID.
"""
import hashlib
import re

import sh_stack

RULE_LINE = re.compile(r"^\s*[-*]\s+\*\*(?P<id>[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\*\*\s+(?P<text>.+?)\s+\(source:\s*(?P<source>.+)\)\s*$")
RULE_LIKE = re.compile(r"^\s*[-*]\s+\*\*[A-Z][A-Z0-9]*-")
# A standard commitment is checked even in the human-written memory bank, so a malformed one cannot vanish.
STANDARD_LIKE = re.compile(r"^\s*[-*]\s+\*\*STD-")
POINTER = re.compile(r"(?i)apply the canonical|coverage ids?:|\bpolicy-\d+\b")
LAYER = re.compile(r"<!-- rule-layer: ([a-z]+) -->")
PACK = re.compile(r"<!-- pack: ([a-z0-9]+(?:-[a-z0-9]+)*) -->")
COMMITMENT = re.compile(r"<!-- commitment: ([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+) -->")
STD_STATUS = re.compile(r"\bstatus: (in place|required|planned)\b")
APPLIES = re.compile(r"<!-- applies: (\S+) (.+?) -->")
OVERRIDES = re.compile(r"\boverrides ([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)")
CHECKED = re.compile(r"checked \d{4}-\d{2}-\d{2}")
OFFICIAL_TEXT = re.compile(r"(?:^|[;,(]\s*)official text:(?!\s*(?:tbd|todo|none|n/a|unknown)\b)[^;]*\d", re.I)
COMMENT = re.compile(r"<!--.*?-->", re.S)
# Higher wins on a conflict: business > standard > decision > project > tool > baseline. A standard
# the owner committed to is an obligation a decision cannot override; only the business layer can.
RANK = {"baseline": 0, "tool": 1, "project": 2, "decision": 3, "standard": 4, "business": 5}
MEMORY_LAYERS = ((".memory/10-product.md", "business"), (".memory/60-decisions.md", "decision"))


def parse(text, strict=True):
    """Return (rules, defects) for one file: rules are dicts with id, text, source and line.

    HTML comments are removed first (their newlines are kept, so line numbers stay real): an example
    rule inside a comment is not a rule, and a trailing comment is not part of the rule line.

    strict=False is for the memory bank, which is human-written prose: only well-formed rule lines
    are rules there, and other lines are left alone.
    """
    rules, defects = [], []
    # Blank each comment but keep its newlines, so example rules inside it are not rules and real line numbers hold.
    text = COMMENT.sub(lambda found: "\n" * found.group(0).count("\n"), text)
    for number, line in enumerate(text.splitlines(), 1):
        if strict and POINTER.search(line):
            defects.append(f"line {number} is a pointer, not a rule; write the rule sentence itself")
            continue
        match = RULE_LINE.match(line)
        if not match:
            if (strict and RULE_LIKE.match(line)) or STANDARD_LIKE.match(line):
                defects.append(f"line {number} is not a readable rule line (- **ID** sentence. (source: ...))")
            continue
        sentence = match.group("text")
        words = re.findall(r"[A-Za-z][A-Za-z'’-]*", sentence)
        if len(words) < 4 or len(sentence.split()) > 60 or not sentence.endswith("."):
            defects.append(f"line {number} rule {match.group('id')} is not one readable sentence of 4 to 60 words ending with a full stop")
        if "PROPOSED" in line:
            defects.append(f"line {number} rule {match.group('id')} is PROPOSED; record the owner's acceptance in .memory/60-decisions.md first")
        rules.append({"id": match.group("id"), "text": sentence, "source": match.group("source").strip(), "line": line.strip(), "number": number})
    return rules, defects


def _words(text):
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _stray_version_patterns(stack_rows):
    patterns = []
    for _, name, declared, locked in stack_rows:
        for value in {locked, re.sub(r"^[^0-9]*", "", declared or "")}:
            if value and re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", value):
                patterns.append((name, re.compile(r"(?<![\w.])" + re.escape(value) + r"(?!\w|\.\d)")))
    return patterns


def check(root, receipt, read, fail, modules, rule_paths, consumers, pack_dir):
    """Run every schema 4 check.

    read(rel) returns bytes or None; modules is [(package_path, row, text)] for every rule module;
    rule_paths are the registered RULES.md routers; consumers is [(label, text)] for skills and role
    GEN blocks; pack_dir is the harness's templates/rule-packs directory.
    """
    rules_by_file = {}

    # The stack: one generated file, rebuilt here from the manifests and compared byte for byte.
    stack = receipt.get("stack")
    stack_rows = []
    if not isinstance(stack, dict) or stack.get("path") != sh_stack.STACK_PATH:
        fail(f"schema 4 receipt needs a stack row with path {sh_stack.STACK_PATH}")
    else:
        current = read(sh_stack.STACK_PATH)
        wanted = sh_stack.render(root)
        if current is None or current != wanted:
            fail(f"{sh_stack.STACK_PATH} is missing or stale against the manifests and lockfiles; run spec-harness stack <target>")
        elif hashlib.sha256(current).hexdigest() != stack.get("sha256"):
            fail(f"{sh_stack.STACK_PATH} changed after the receipt; record its new sha256")
        stack_rows = sh_stack.entries(root)
    locked = {}
    for package, name, declared, version in stack_rows:
        locked.setdefault((package, name), version or declared)

    def add_file(rel, text, layer):
        rules, defects = parse(text, strict=layer not in ("business", "decision"))
        for defect in defects:
            fail(f"{rel}: {defect}")
        for rule in rules:
            rule["file"], rule["layer"] = rel, layer
        rules_by_file[rel] = rules

    for rel in rule_paths:
        data = read(rel)
        if data is not None:
            add_file(rel, data.decode("utf-8", errors="replace"), "project")

    shipped = {}
    committed = []
    for package_path, row, text in modules:
        rel = row.get("path")
        layer_match = LAYER.search(text)
        layer = layer_match.group(1) if layer_match else None
        if layer not in ("baseline", "tool", "project", "standard"):
            fail(f"{rel}: rule module needs <!-- rule-layer: baseline|tool|project|standard -->")
            continue
        add_file(rel, text, layer)
        if not rules_by_file[rel]:
            fail(f"{rel}: rule module has no rule lines")
        pack_match = PACK.search(text)
        if layer == "standard":
            commitments = COMMITMENT.findall(text)
            if not commitments:
                fail(f"{rel}: a standard module needs <!-- commitment: STD-<n> --> naming the owner's commitment in .memory/10-product.md")
            committed.extend((rel, item) for item in commitments)
        if layer == "baseline" and not pack_match:
            fail(f"{rel}: a baseline module must come from a shipped pack (<!-- pack: baseline-... -->)")
        applies = APPLIES.search(text)
        if layer == "tool":
            if not applies:
                fail(f"{rel}: a tool module needs <!-- applies: <package> <range> -->")
            elif (package_path, applies.group(1)) not in locked:
                fail(f"{rel}: applies to {applies.group(1)}, which package {package_path} does not declare in {sh_stack.STACK_PATH}")
            elif not sh_stack.satisfies(locked[(package_path, applies.group(1))], applies.group(2)):
                fail(f"{rel}: the stack version of {applies.group(1)} is outside this module's range {applies.group(2)}; refresh or remove the module")
        if pack_match:
            name = pack_match.group(1)
            pack_file = pack_dir / f"{name}.md"
            if not pack_file.is_file():
                fail(f"{rel}: names pack {name}, which this harness does not ship")
                continue
            pack_text = pack_file.read_text()
            shipped[name] = rel
            pack_lines = {rule["line"] for rule in parse(pack_text)[0]}
            for rule in rules_by_file[rel]:
                if rule["line"] not in pack_lines:
                    fail(f"{rel}: rule {rule['id']} differs from pack {name}; copy pack lines byte for byte, override in a higher layer")
            pack_layer, pack_applies = LAYER.search(pack_text), APPLIES.search(pack_text)
            if not pack_layer or pack_layer.group(1) != layer or (pack_applies.group(0) if pack_applies else None) != (applies.group(0) if applies else None):
                fail(f"{rel}: rule-layer or applies marker differs from pack {name}")
        elif layer in ("tool", "standard"):
            for rule in rules_by_file[rel]:
                linked = "http" in rule["source"] and CHECKED.search(rule["source"])
                # A law or standard can be named precisely without a link (and without an outbound request).
                named = layer == "standard" and OFFICIAL_TEXT.search(rule["source"])
                if not (linked or named):
                    hint = " or 'official text: <instrument and article>' (at the start of the source or after ';', ',' or '(')" if layer == "standard" else ""
                    fail(f"{rel}: {layer} rule {rule['id']} without a pack needs an official documentation URL and 'checked YYYY-MM-DD'{hint} in its source")

    # v1: packs are recommended, not required; `init` adopts the ones that apply (commands/rules.md).

    for rel, layer in MEMORY_LAYERS:
        data = read(rel)
        if data is not None:
            add_file(rel, data.decode("utf-8", errors="replace"), layer)

    # Standards: each STD- commitment states its status and is carried out by at least one standard
    # module; each standard module names a commitment that exists.
    commitments = [rule for rule in rules_by_file.get(".memory/10-product.md", []) if rule["id"].startswith("STD-")]
    for rule in commitments:
        if not STD_STATUS.search(rule["source"]):
            fail(f".memory/10-product.md: standard commitment {rule['id']} needs 'status: in place|required|planned' in its source tag")
        if rule["id"] not in {item for _, item in committed}:
            fail(f"standard commitment {rule['id']} has no standard rule module; adopt its pack or write ai_rules/rules/standard-<name>.md")
    for rel, item in committed:
        if item not in {rule["id"] for rule in commitments}:
            fail(f"{rel}: names commitment {item}, which .memory/10-product.md does not define")

    # One ID, one rule; one rule, one ID.
    every = [rule for rules in rules_by_file.values() for rule in rules]
    by_id = {}
    for rule in every:
        if rule["id"] in by_id:
            other = by_id[rule["id"]]
            fail(f"rule ID {rule['id']} is defined twice: {other['file']}:{other['number']} and {rule['file']}:{rule['number']}")
        else:
            by_id[rule["id"]] = rule
    for index, rule in enumerate(every):
        mine = _words(rule["text"])
        for other in every[index + 1:]:
            theirs = _words(other["text"])
            if mine == theirs:
                fail(f"rules {rule['id']} and {other['id']} say the same thing; keep one and reference it")
    for rule in every:
        for target in OVERRIDES.findall(rule["source"]):
            if target not in by_id:
                fail(f"rule {rule['id']} overrides {target}, which is not defined")
            elif RANK[rule["layer"]] <= RANK[by_id[target]["layer"]]:
                fail(f"rule {rule['id']} ({rule['layer']}) cannot override {target} ({by_id[target]['layer']}); only a higher layer can")

    conflicts = receipt.get("rule_conflicts", [])
    for row in conflicts if isinstance(conflicts, list) else [None]:
        if not isinstance(row, dict) or not isinstance(row.get("ids"), list) or len(row["ids"]) < 2:
            fail("each rule_conflicts row needs the ids of at least two rules")
            continue
        missing = [item for item in row["ids"] if item not in by_id]
        if missing:
            fail(f"rule conflict names undefined rules: {', '.join(map(str, missing))}")
        if row.get("status") != "resolved":
            fail(f"rule conflict {' vs '.join(map(str, row['ids']))} is open; ask the owner and record the decision")
        elif row.get("winner") not in row["ids"] or not str(row.get("reason", "")).strip():
            fail(f"resolved rule conflict {' vs '.join(map(str, row['ids']))} needs a winner from its ids and a reason")

    # Versions live only in the stack; rules live only in rule files.
    patterns = _stray_version_patterns(stack_rows)
    long_rules = [rule for rule in every if len(rule["text"].split()) >= 8]
    # Rule files are scanned rule line by rule line; skills and role blocks are scanned whole.
    places = [(f"{rule['file']}:{rule['number']}", rule["line"]) for rule in every]
    for label, text in places + list(consumers):
        visible = COMMENT.sub("", text)
        for name, pattern in patterns:
            match = pattern.search(visible)
            if match:
                fail(f"{label}: names a version of {name} ({match.group(0)!r}); versions live only in {sh_stack.STACK_PATH}")
                break
    for label, text in consumers:
        for rule in long_rules:
            if rule["text"] in text:
                fail(f"{label}: copies rule {rule['id']}; name the rule ID instead")
    return by_id
