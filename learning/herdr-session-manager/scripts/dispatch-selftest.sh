#!/usr/bin/env bash
# dispatch-selftest.sh: planted-failure checks for dispatch.sh. Every case plants a fault and expects the guard to catch it;
# a negative control shows the guard stays quiet when nothing is wrong. herdr is faked, so no real tab opens.
# Run: bash scripts/dispatch-selftest.sh      (DISPATCH_SCRIPT=<file> tests another copy, used to prove the test can fail)
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"; D="${DISPATCH_SCRIPT:-$HERE/scripts/dispatch.sh}"; FX="$HERE/fixtures"
T=$(mktemp -d); mkdir -p "$T/bin" "$T/root/state" "$T/root/reports" "$T/shim"
export DISPATCH_ROOT="$T/root" SHIM="$T/shim" DISPATCH_LINK_TRIES=1
cat > "$T/bin/herdr" <<'SH'
#!/usr/bin/env bash
case "$1 $2" in
  "agent list") [ -f "$SHIM/fail" ] && exit 1; cat "$SHIM/agents.json" ;;
  "pane read") cat "$SHIM/pane-$3.txt" 2>/dev/null ;;
  "agent prompt") echo "$3" >> "$SHIM/prompted" ;;
  "tab create") echo '{"result":{"pane":{"pane_id":"w1:pNEW"}}}'; echo created >> "$SHIM/created" ;;
  *) : ;;
esac
SH
chmod +x "$T/bin/herdr"; export PATH="$T/bin:$PATH" HERDR_WORKSPACE_ID=w1 HERDR_PANE_ID=w1:pM
agents() { python3 - "$@" <<'PY'
import json,sys
print(json.dumps({"result":{"agents":[{"pane_id":a.split("=")[0],"agent_status":a.split("=")[1],"tab_id":"t","terminal_title_stripped":"x"} for a in sys.argv[1:]]}}))
PY
}
hash_() { md5 -q 2>/dev/null || md5sum | cut -d' ' -f1; }
pass=0; fail=0
ck() { if [ "$2" = "$3" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 (want '$2' got '$3')"; fail=$((fail+1)); fi; }
S="$T/root/state/watch.tsv"

# stuck_check: empty hash never STUCK; a real unchanged hash IS stuck (negative control)
ck "stuck_check empty hash" "ok w1:p1" "$(bash "$D" _stuckcheck "$T/s1" w1:p1 "" 100000 900)"
printf 'w1:p4\tabc\t1000\n' > "$T/s4"; ck "stuck_check real stuck still caught" "STUCK w1:p4 99000s" "$(bash "$D" _stuckcheck "$T/s4" w1:p4 abc 100000 900)"

# a ticking-but-unchanged pane hashes equal; a real change differs
h1=$(bash "$D" _normalize < "$FX/pane-working-t1.txt" | hash_); h2=$(bash "$D" _normalize < "$FX/pane-working-t2.txt" | hash_)
ck "ticking pane hashes equal after normalize" "$h1" "$h2"
h3=$( { bash "$D" _normalize < "$FX/pane-working-t1.txt"; echo "new assistant text"; } | hash_)
ck "real content change still differs (negative control)" "differ" "$([ "$h1" != "$h3" ] && echo differ || echo same)"
agents w1:p9=working > "$SHIM/agents.json"; cp "$FX/pane-working-t1.txt" "$SHIM/pane-w1:p9.txt"
bash "$D" watch 0 >/dev/null 2>&1; cp "$FX/pane-working-t2.txt" "$SHIM/pane-w1:p9.txt"; sleep 1
out=$(bash "$D" watch 0 2>&1); ck "watch flags ticking-but-unchanged pane" "yes" "$(echo "$out" | grep -q '^STUCK w1:p9' && echo yes || echo no)"
cp "$FX/pane-working-t1.txt" "$SHIM/pane-w1:p9.txt"; echo "step A" >> "$SHIM/pane-w1:p9.txt"; bash "$D" watch 0 >/dev/null 2>&1
echo "step B" >> "$SHIM/pane-w1:p9.txt"; out=$(bash "$D" watch 0 2>&1)
ck "watch quiet on a pane that moves" "no" "$(echo "$out" | grep -q '^STUCK' && echo yes || echo no)"

# blocked pane: not STUCK, reported as waiting on you
rm -f "$S"; agents w1:pB=blocked > "$SHIM/agents.json"; echo same > "$SHIM/pane-w1:pB.txt"
bash "$D" watch 0 >/dev/null 2>&1; sleep 1; out=$(bash "$D" watch 0 2>&1)
ck "watch never STUCKs a blocked pane" "no" "$(echo "$out" | grep -q '^STUCK' && echo yes || echo no)"
ck "watch reports blocked as waiting on you" "yes" "$(echo "$out" | grep -q 'waiting on you.*w1:pB' && echo yes || echo no)"

# finish: a report only counts if it exists on disk and is fresh. Planted: a path that does not exist.
echo "report: reports/2026-01-01-ghost.md" > "$T/txt"
ck "report guard rejects a path that is not on disk" "" "$(bash "$D" _reportcheck "$T/txt" 0)"
echo x > "$T/root/reports/real.md"; echo "report: reports/real.md" > "$T/txt"
ck "report guard accepts a real fresh report (negative control)" "reports/real.md" "$(bash "$D" _reportcheck "$T/txt" 0)"
ck "report guard rejects a stale report" "" "$(bash "$D" _reportcheck "$T/txt" 99999999999)"

# capacity cap
echo "goal" > "$T/prompt.md"; rm -f "$SHIM/created"
touch "$SHIM/fail"; DISPATCH_MAX_TABS=6 bash "$D" start "g" "$T/prompt.md" >/dev/null 2>&1; rc=$?
ck "cap fails closed on herdr list error (rc)" "1" "$rc"; ck "cap fail-closed opened nothing" "no" "$([ -f "$SHIM/created" ] && echo yes || echo no)"
rm -f "$SHIM/fail" "$SHIM/created"
agents w1:pM=working w1:p1=done w1:p2=idle w1:p3=done > "$SHIM/agents.json"
DISPATCH_LINK_TRIES=1 DISPATCH_MAX_TABS=3 timeout 30 bash "$D" start "g" "$T/prompt.md" >/dev/null 2>&1
ck "cap ignores done/idle tabs (opened)" "yes" "$([ -f "$SHIM/created" ] && echo yes || echo no)"
rm -f "$SHIM/created"; agents w1:pM=working w1:p1=working w1:p2=blocked > "$SHIM/agents.json"
DISPATCH_MAX_TABS=3 bash "$D" start "g" "$T/prompt.md" >/dev/null 2>&1; rc=$?
ck "cap refuses at working+blocked >= max (rc)" "1" "$rc"; ck "cap refusal opened nothing" "no" "$([ -f "$SHIM/created" ] && echo yes || echo no)"
# input guards
bash "$D" start "g" "$T/missing.md" >/dev/null 2>&1; ck "missing prompt file exits 1" "1" "$?"
bash "$D" start "" "$T/prompt.md" >/dev/null 2>&1; ck "empty name exits 1" "1" "$?"
bash "$D" close w1:p1 >/dev/null 2>&1; ck "close without --force exits 1" "1" "$?"
# finish: never types into a blocked or working tab, nor into the caller's own pane (planted: a blocked tab)
export DISPATCH_FINISH_SETTLE=0
rm -f "$SHIM/prompted"; agents w1:pB=blocked > "$SHIM/agents.json"
bash "$D" finish w1:pB >/dev/null 2>&1; ck "finish refuses a blocked tab (rc)" "1" "$?"
ck "finish typed nothing into a blocked tab" "no" "$([ -f "$SHIM/prompted" ] && echo yes || echo no)"
agents w1:pW=working > "$SHIM/agents.json"; bash "$D" finish w1:pW >/dev/null 2>&1
ck "finish typed nothing into a working tab" "no" "$([ -f "$SHIM/prompted" ] && echo yes || echo no)"
agents w1:pM=done > "$SHIM/agents.json"; bash "$D" finish w1:pM >/dev/null 2>&1; ck "finish refuses its own pane (rc)" "1" "$?"
ck "finish typed nothing into its own pane" "no" "$([ -f "$SHIM/prompted" ] && echo yes || echo no)"
agents w1:pD=done > "$SHIM/agents.json"; bash "$D" finish w1:pD >/dev/null 2>&1
ck "finish types the routine into a done tab (negative control)" "w1:pD" "$(cat "$SHIM/prompted" 2>/dev/null)"
# start: a relative task file is read from the kit root; a quote in the name is refused
echo goal > "$T/root/rel.md"; rm -f "$SHIM/created"; agents w1:pM=working > "$SHIM/agents.json"
(cd / && DISPATCH_MAX_TABS=9 timeout 30 bash "$D" start "g" rel.md >/dev/null 2>&1); ck "start finds a relative file under the kit root" "yes" "$([ -f "$SHIM/created" ] && echo yes || echo no)"
cp "$T/prompt.md" "$T/it's.md"; bash "$D" start "g" "$T/it's.md" >/dev/null 2>&1; ck "start refuses a quote in the file name" "1" "$?"
# status: a herdr error is one line, not a traceback
touch "$SHIM/fail"; out=$(bash "$D" status 2>&1); rc=$?; rm -f "$SHIM/fail"
ck "status reports a herdr error (rc)" "1" "$rc"; ck "status prints no traceback" "no" "$(echo "$out" | grep -q Traceback && echo yes || echo no)"
echo "--- $pass passed, $fail failed"; rm -rf "$T"; [ "$fail" = 0 ]
