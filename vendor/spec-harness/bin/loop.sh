#!/usr/bin/env bash
# Spec Harness minimal loop: find work -> act -> VERIFY -> log -> repeat
# Tool-agnostic. Swap `your-agent-cli` for `claude -p`, codex, etc.
# The verifier is the whole point: nothing counts until a SEPARATE checker returns PASS.
set -euo pipefail

# ── Guardrails (a loop that runs unattended needs brakes) ───────────────────
MAX_RUNS="${MAX_RUNS:-10}"          # run cap — the anti-runaway-bill brake
GOAL="${GOAL:-goal.md}"             # the /goal end-state the verifier checks against
MEMORY="${MEMORY:-.memory/40-active.md}"
RULES="${RULES:-AGENTS.md}"
VERIFIER="${VERIFIER:-.claude/agents/sdd-verifier.md}"
LOG="${LOG:-loop.log}"
# Spend cap is set on the API key/account, NOT here — the schedule must never be the
# only thing between you and the bill.

run=0
echo "[$(date -u +%FT%TZ)] loop start — max ${MAX_RUNS} runs, goal=${GOAL}" >> "$LOG"

while [ "$run" -lt "$MAX_RUNS" ]; do
  run=$((run+1))

  # 1. ACT — worker reads memory + rules, attempts the goal (one SDD task)
  worker_output=$(your-agent-cli run \
      --memory "$MEMORY" \
      --rules "$RULES" \
      --goal "$GOAL") \
    || { echo "[$(date -u +%FT%TZ)] run $run: worker errored, stopping" >> "$LOG"; break; }

  # 2. VERIFY — SEPARATE checker, clean context, only output PASS/FAIL vs the end-state
  result=$(your-agent-cli run --agent "$VERIFIER" \
      --input "$worker_output" --goal "$GOAL")

  # 3. LOG + DECIDE
  echo "[$(date -u +%FT%TZ)] run $run: $(echo "$result" | grep -o 'RESULT: [A-Z]*')" >> "$LOG"
  if echo "$result" | grep -q "RESULT: PASS"; then
    echo "[$(date -u +%FT%TZ)] goal verified after $run run(s). done." >> "$LOG"
    exit 0
  fi
  # FAIL -> loop again. AGENTS.md should have absorbed the cause as a new rule (the ratchet).
done

echo "[$(date -u +%FT%TZ)] hit MAX_RUNS=${MAX_RUNS} without PASS. human needed." >> "$LOG"
exit 1

# Schedule it (every 30 min) — only AFTER you've run it by hand and read the log once:
#   crontab -e
#   */30 * * * * cd /path/to/project && MAX_RUNS=5 ./loop.sh >> loop.log 2>&1
