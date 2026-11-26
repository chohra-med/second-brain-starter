#!/usr/bin/env bash
# dispatch.sh: one herdr tab per task, each a real Claude session with remote control.
#
#   dispatch.sh start "<short name>" <prompt-file> [model]   open a tab, start claude, log it
#   dispatch.sh status                                       every agent: pane, state, name
#   dispatch.sh wait <pane>                                  block until that pane is done or needs you
#   dispatch.sh watch [minutes]                              flag working panes whose screen has not changed (default 15)
#   dispatch.sh finish <pane>                                run the end-of-session routine, check it wrote a report, then close
#                                                            (refuses a tab that is not done or idle, and this session's own pane)
#   dispatch.sh close <pane> --force                         close WITHOUT the routine (only when you say so)
#
# Settings (environment variables, all optional):
#   DISPATCH_MODEL     model for new tabs                (default: sonnet)
#   DISPATCH_MAX_TABS  live agents allowed at once       (default: 6; the master counts as one)
#   DISPATCH_END_CMD   what `finish` types in the tab    (default: /end-session)
#   DISPATCH_REPORT_DIR folder a finished tab must write its report into (default: reports)
# Tab names: keep them SHORT (3 words). The herdr sidebar cuts long names.
# Exit 1 on a missing prompt file, an unknown pane, a full house or a herdr error.
set -u
ROOT="${DISPATCH_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
STATE="$ROOT/state"; LEDGER="$STATE/ledger.tsv"; WATCH_STATE="$STATE/watch.tsv"
WS="${HERDR_WORKSPACE_ID:-}"
MAX_TABS="${DISPATCH_MAX_TABS:-6}"
MODEL="${DISPATCH_MODEL:-sonnet}"
END_CMD="${DISPATCH_END_CMD:-/end-session}"
REPORT_DIR="${DISPATCH_REPORT_DIR:-reports}"

agents() { herdr agent list 2>/dev/null; }
# agents_ok: true only when herdr answered with valid JSON (an error must never read as "0 live").
agents_ok() { agents | python3 -c "import json,sys;json.load(sys.stdin)['result']['agents']" >/dev/null 2>&1; }
# normalize: drops Claude's spinner/timer line and every digit, so a session that ticks but does not progress hashes the same.
normalize() { grep -v -E '…[[:space:]]*\(' | tr -d '0-9'; }
field() { python3 -c "import json,sys;d=json.load(sys.stdin);a=[x for x in d['result']['agents'] if x['pane_id']==sys.argv[1]];print(a[0].get(sys.argv[2],'') if a else '')" "$1" "$2"; }

# report_in <text> <since-epoch>: print the newest report file named in <text> that exists and was written at or after <since>.
report_in() {
  printf '%s' "$1" | grep -oE "$REPORT_DIR/[A-Za-z0-9._-]+\.md" | sort -u | while read -r r; do
    f="$ROOT/$r"; [ -f "$f" ] || continue
    [ -s "$f" ] || continue
    [ "$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")" -ge "$2" ] && echo "$r"
  done | tail -1
}

# stuck_check <state-file> <pane> <screen-hash> <now> <limit-seconds>: "STUCK <pane> <secs>" or "ok <pane>".
stuck_check() {
  local sf="$1" pane="$2" h="$3" now="$4" lim="$5" oh since
  touch "$sf"
  [ -n "$h" ] || { echo "ok $pane"; return; }   # nothing measured, never STUCK
  read -r oh since < <(awk -F'\t' -v p="$pane" '$1==p{print $2, $3}' "$sf")
  if [ "${oh:-}" = "$h" ] && [ -n "${since:-}" ]; then
    if [ $((now - since)) -ge "$lim" ]; then echo "STUCK $pane $((now - since))s"; else echo "ok $pane"; fi
  else
    { grep -v "^$pane	" "$sf"; printf '%s\t%s\t%s\n' "$pane" "$h" "$now"; } > "$sf.tmp"; mv "$sf.tmp" "$sf"
    echo "ok $pane"
  fi
}

cmd="${1:-}"; [ $# -gt 0 ] && shift
[ "$cmd" = "_normalize" ] && { normalize; exit 0; }            # test hooks
[ "$cmd" = "_stuckcheck" ] && { stuck_check "$@"; exit 0; }
[ "$cmd" = "_reportcheck" ] && { report_in "$(cat "$1")" "$2"; exit 0; }
case "$cmd" in
  start)
    label="${1:-}"; file="${2:-}"; model="${3:-$MODEL}"
    [ -n "$label" ] || { echo "dispatch: give a short task name as the first argument" >&2; exit 1; }
    case "$file" in *"'"*) echo "dispatch: the prompt file name may not contain a single quote: $file" >&2; exit 1;; esac
    case "$file" in /*) fp="$file" ;; *) fp="$ROOT/$file" ;; esac
    [ -f "$fp" ] || { echo "dispatch: prompt file missing: $file (a relative path is read from $ROOT, where the tab opens)" >&2; exit 1; }
    [ -n "$WS" ] || { echo "dispatch: not inside herdr (HERDR_WORKSPACE_ID unset)" >&2; exit 1; }
    # Capacity: fail CLOSED if herdr cannot list agents. Only working + blocked count. A lock stops two starts racing.
    LOCK="$STATE/start.lock"; mkdir -p "$STATE"
    [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +2)" ] && rmdir "$LOCK" 2>/dev/null
    got=0; for _ in $(seq 1 "${DISPATCH_LOCK_WAIT:-30}"); do mkdir "$LOCK" 2>/dev/null && { got=1; break; }; sleep 1; done
    [ "$got" = 1 ] || { echo "dispatch: another start holds the lock, nothing opened. Retry in a minute." >&2; exit 1; }
    trap 'rmdir "$LOCK" 2>/dev/null' EXIT
    agents_ok || { echo "dispatch: herdr agent list failed, cannot count live agents. Nothing opened." >&2; exit 1; }
    live=$(agents | HERDR_PANE_ID="${HERDR_PANE_ID:-}" python3 -c "
import json,sys,os
ag=json.load(sys.stdin)['result']['agents']
n=sum(1 for a in ag if a['agent_status'] in ('working','blocked'))
me=os.environ.get('HERDR_PANE_ID','')
if me and not any(a['pane_id']==me and a['agent_status'] in ('working','blocked') for a in ag): n+=1
print(n)")
    [ "$live" -lt "$MAX_TABS" ] || { echo "dispatch: $live live agents, cap is $MAX_TABS (DISPATCH_MAX_TABS). Nothing opened; keep the task queued on the board." >&2; exit 1; }
    out=$(herdr tab create --workspace "$WS" --cwd "$ROOT" --label "$label" 2>&1)
    pane=$(printf '%s' "$out" | grep -o '"pane_id":"[^"]*"' | head -1 | cut -d'"' -f4)
    [ -n "$pane" ] || { echo "dispatch: herdr could not open a tab: $out" >&2; exit 1; }
    safe=$(printf '%s' "$label" | tr "'" ' ')
    herdr pane run "$pane" "claude -n '$safe' --model $model --remote-control '$safe' 'Read $file and do it. Dispatched by the master session; report back with a result: line.'" >/dev/null 2>&1 \
      || { echo "dispatch: could not start claude in $pane" >&2; exit 1; }
    for _ in $(seq 1 10); do agents | field "$pane" agent_status | grep -q . && break; sleep 2; done   # hold the lock until the agent is counted
    rmdir "$LOCK" 2>/dev/null; trap - EXIT
    link=""
    for _ in $(seq 1 "${DISPATCH_LINK_TRIES:-40}"); do
      link=$(herdr pane read "$pane" --source recent --lines 60 2>/dev/null | grep -oE 'https://claude.ai/code/session_[A-Za-z0-9]+' | head -1)
      [ -n "$link" ] && break; sleep 3
    done
    [ -f "$LEDGER" ] || printf 'started\tpane\tmodel\tname\tprompt_file\tphone_link\n' > "$LEDGER"
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M')" "$pane" "$model" "$label" "$file" "${link:-none}" >> "$LEDGER"
    echo "pane=$pane model=$model phone=${link:-none (no remote-control link within 2 min)}"
    ;;
  status)
    agents_ok || { echo "dispatch: herdr agent list failed, cannot show status" >&2; exit 1; }
    agents | python3 -c "
import json,sys
for a in json.load(sys.stdin)['result']['agents']:
    print(a['pane_id'], a['agent_status'], a.get('terminal_title_stripped',''), sep='\t')"
    ;;
  wait)
    pane="${1:-}"
    agents_ok || { echo "dispatch: herdr agent list failed, cannot wait" >&2; exit 1; }
    [ -n "$(agents | field "$pane" agent_status)" ] || { echo "dispatch: unknown pane $pane" >&2; exit 1; }
    herdr agent wait "$pane" --until done --until blocked --timeout 3000000 >/dev/null 2>&1
    echo "$pane $(agents | field "$pane" agent_status)"
    ;;
  watch)
    mins="${1:-15}"; now=$(date +%s); flagged=0
    agents_ok || { echo "dispatch: herdr agent list failed, cannot watch" >&2; exit 1; }
    rows=$(agents | python3 -c "
import json,sys
for a in json.load(sys.stdin)['result']['agents']: print(a['pane_id'], a['agent_status'], sep='\t')")
    mkdir -p "$STATE"; touch "$WATCH_STATE"
    awk -F'\t' 'NR==FNR{live[$1]=1;next} ($1 in live)' <(printf '%s\n' "$rows") "$WATCH_STATE" > "$WATCH_STATE.tmp"; mv "$WATCH_STATE.tmp" "$WATCH_STATE"
    while IFS=$'\t' read -r pane st; do
      [ -n "$pane" ] || continue
      case "$st" in
        blocked) echo "waiting on you: $pane (asked a question, not stuck)" ;;
        working)
          h=$(herdr pane read "$pane" --source recent --lines 30 2>/dev/null | normalize | (md5 -q 2>/dev/null || md5sum | cut -d' ' -f1))
          [ "$h" = "d41d8cd98f00b204e9800998ecf8427e" ] && h=""
          r=$(stuck_check "$WATCH_STATE" "$pane" "$h" "$now" $((mins * 60)))
          case "$r" in STUCK*) echo "$r"; flagged=1;; esac ;;
      esac
    done <<< "$rows"
    [ "$flagged" = 1 ] && exit 2
    echo "watch: no working pane unchanged for $mins min"
    ;;
  finish)
    # Never just close a tab: run the end-of-session routine so the work and lessons are saved, check it wrote a report, then close.
    pane="${1:-}"
    [ -n "$pane" ] && [ "$pane" = "${HERDR_PANE_ID:-}" ] && { echo "dispatch: $pane is this session's own pane; finish only another tab" >&2; exit 1; }
    agents_ok || { echo "dispatch: herdr agent list failed, cannot finish" >&2; exit 1; }
    tab=$(agents | field "$pane" tab_id)
    [ -n "$tab" ] || { echo "dispatch: unknown pane $pane" >&2; exit 1; }
    st=$(agents | field "$pane" agent_status)
    case "$st" in
      done|idle) ;;
      *) echo "dispatch: $pane is '$st', not done or idle. finish types into the tab, so a blocked tab would take it as its answer. Answer or wait first; nothing was typed." >&2; exit 1 ;;
    esac
    since=$(date +%s)
    herdr agent prompt "$pane" "$END_CMD. When done, print one line: report: $REPORT_DIR/<file>.md" >/dev/null 2>&1
    sleep "${DISPATCH_FINISH_SETTLE:-6}"
    herdr agent wait "$pane" --until done --until blocked --timeout 3000000 >/dev/null 2>&1
    rep=$(report_in "$(herdr pane read "$pane" --source recent --lines 120 2>/dev/null)" "$since")
    if [ -n "$rep" ]; then
      herdr tab close "$tab" >/dev/null 2>&1 || { echo "dispatch: report written but herdr could not close $tab" >&2; exit 1; }
      echo "finished $pane: report $rep, tab closed"
    else
      echo "dispatch: $pane did not name a fresh report in $REPORT_DIR/; tab LEFT OPEN" >&2; exit 1
    fi
    ;;
  close)
    pane="${1:-}"; force="${2:-}"
    [ "$force" = "--force" ] || { echo "dispatch: use 'finish $pane'. 'close $pane --force' only when you say so." >&2; exit 1; }
    tab=$(agents | field "$pane" tab_id)
    [ -n "$tab" ] || { echo "dispatch: unknown pane $pane" >&2; exit 1; }
    herdr tab close "$tab" >/dev/null 2>&1 || { echo "dispatch: herdr could not close $tab" >&2; exit 1; }
    echo "closed $tab ($pane)"
    ;;
  *) sed -n '2,19p' "$0"; exit 1 ;;
esac
