#!/usr/bin/env bash
# sh-install.sh — safely stage Spec Harness files in a new or existing project.
set -o pipefail

SYS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENTRYPOINT=install
INTERNAL_MODE=

if [ "${1:-}" = "--internal-new" ]; then
  [ "$#" -eq 3 ] || { echo "usage: sh-install.sh --internal-new <target-dir> <project-name>" >&2; exit 2; }
  ENTRYPOINT=init
  INTERNAL_MODE=new
  TARGET=$2
  NAME=$3
elif [ "${1:-}" = "--entrypoint" ]; then
  [ "$#" -ge 2 ] || { echo "usage: sh-install.sh --entrypoint <init|install> <target-dir> [mode] [name]" >&2; exit 2; }
  ENTRYPOINT=$2
  shift 2
  case "$ENTRYPOINT" in init|install) ;; *) echo "invalid entrypoint: $ENTRYPOINT" >&2; exit 2 ;; esac
  [ "$#" -ge 1 ] || { echo "usage: spec-harness $ENTRYPOINT <target-dir> [mode] [name]" >&2; exit 2; }
  TARGET=$1
  shift
else
  [ "$#" -ge 1 ] || { echo "usage: sh-install.sh <target-dir> [mode] [name]" >&2; exit 2; }
  TARGET=$1
  shift
fi

usage_error() { echo "$1" >&2; exit 2; }

if [ -z "$INTERNAL_MODE" ]; then
  MODE=auto
  NAME=
  case "$ENTRYPOINT:$#" in
    init:0) ;;
    init:1)
      case "$1" in
        auto|new|integrate) MODE=$1 ;;
        *) MODE=new; NAME=$1 ;;
      esac
      ;;
    init:2)
      case "$1" in auto|new|integrate) MODE=$1; NAME=$2 ;;
        *) usage_error "invalid mode '$1'; expected auto, new, or integrate" ;;
      esac
      ;;
    install:0) ;;
    install:1)
      case "$1" in auto|new|integrate) MODE=$1 ;;
        *) NAME=$1 ;;
      esac
      ;;
    install:2)
      case "$1" in auto|new|integrate) MODE=$1; NAME=$2 ;;
        *) usage_error "invalid mode '$1'; expected auto, new, or integrate" ;;
      esac
      ;;
    *) usage_error "too many arguments; expected target, optional mode, and optional project name" ;;
  esac
fi

if [ ! -d "$TARGET" ]; then
  usage_error "target must be an existing directory: $TARGET"
fi
TARGET_INPUT=$TARGET
case "$TARGET_INPUT" in /*) ;; *) TARGET_INPUT="$PWD/$TARGET_INPUT" ;; esac
ABS="$(cd -P "$TARGET_INPUT" 2>/dev/null && pwd -P)" || usage_error "cannot resolve target directory: $TARGET"

if [ -z "${NAME:-}" ]; then NAME="${ABS##*/}"; fi
if [ -z "$NAME" ]; then usage_error "project name must not be empty"; fi
case "$NAME" in
  *$'\n'*|*$'\r'*|*$'\t'*|*"/"*|*"\\"*) usage_error "project name cannot contain a path separator or line break" ;;
esac

case "$ABS/" in
  */second-brain/*) usage_error "refusing: never Spec Harness-ify the vault (resolved target: $ABS)" ;;
esac

if [ -z "$INTERNAL_MODE" ]; then
  case "$MODE" in
    auto)
      if [ -d "$ABS/.git" ] || [ -f "$ABS/.git" ] || [ -f "$ABS/package.json" ] || [ -f "$ABS/pyproject.toml" ]; then MODE=integrate; else MODE=new; fi
      ;;
    new|integrate) ;;
    *) usage_error "invalid mode '$MODE'; expected auto, new, or integrate" ;;
  esac
else
  MODE=$INTERNAL_MODE
fi

if [ ! -d "$SYS_DIR/agents" ] || [ ! -d "$SYS_DIR/commands" ] || [ ! -d "$SYS_DIR/skills" ]; then
  echo "Spec Harness source is incomplete; no target files were written." >&2
  exit 1
fi

PLAN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/spec-harness-install.XXXXXX")" || { echo "cannot create installer plan" >&2; exit 1; }
cleanup() { rm -rf "$PLAN_DIR"; }
trap cleanup EXIT HUP INT TERM

PLAN_RELS=()
PLAN_SRCS=()
ADDED=()
PRESERVED=()
CONFLICTS=()
INSTALL_DIRS=(
  .claude/agents .claude/commands .claude/commands/spec-harness .claude/skills .claude/spec-harness/methods
  .agents/skills .agents/skills/sdd .memory
  ai_rules/rules learning learning/lessons specs workflows
)
PENDING=(
  "AGENTS.md (project-derived rules and protected paths)"
  "RULES.md (project-derived root coding, architecture, packages, testing, and review rules)"
  "goal.md (feature-specific checkable acceptance)"
  ".memory/00-description.md"
  ".memory/01-brief.md"
  ".memory/10-product.md"
  ".memory/20-system.md"
  ".memory/30-tech.md"
  ".memory/40-active.md"
  ".memory/50-progress.md"
  ".memory/60-decisions.md"
  ".memory/70-knowledge.md"
  "ai_rules/rules/frequent_rules.md (project-derived rules)"
)

plan_copy() {
  PLAN_RELS+=("$1")
  PLAN_SRCS+=("$2")
}

render_template() {
  local template=$1 token=$2 replacement=$3 line
  [ -f "$SYS_DIR/$template" ] || { echo "missing installer source: $SYS_DIR/$template; no target files were written." >&2; exit 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line//"$token"/"$replacement"}
    printf '%s\n' "$line"
  done <"$SYS_DIR/$template"
}

plan_template() {
  local rel=$1 template=$2 token=$3 replacement=$4 index=${#PLAN_RELS[@]} expected
  expected="$PLAN_DIR/$index"
  render_template "$template" "$token" "$replacement" >"$expected"
  chmod 644 "$expected"
  PLAN_RELS+=("$rel")
  PLAN_SRCS+=("$expected")
}

# Both modes stage the same complete startup set. Existing files are preserved below.
plan_template AGENTS.md templates/AGENTS.md '{{PROJECT_NAME}}' "$NAME"
plan_template CLAUDE.md templates/CLAUDE.md '{{PROJECT_NAME}}' "$NAME"
plan_template constitution.md templates/constitution.md '{{PROJECT_NAME}}' "$NAME"
plan_template RULES.md templates/RULES.md '{{DIR}}' "$NAME (repo root - base rules)"
plan_copy goal.md "$SYS_DIR/templates/goal.template.md"
plan_copy loop.sh "$SYS_DIR/bin/loop.sh"
plan_copy workflows/README.md "$SYS_DIR/templates/workflows/README.md"
plan_copy workflows/EXAMPLE.md "$SYS_DIR/templates/workflows/EXAMPLE.md"

plan_template SPEC-HARNESS.md templates/install/SPEC-HARNESS.md '{{PROJECT_NAME}}' "$NAME"

for file in 00-description 01-brief 10-product 20-system 30-tech 40-active 50-progress 60-decisions 70-knowledge 80-feedback; do
  plan_template ".memory/$file.md" "templates/install/memory/$file.md" '{{PROJECT_NAME}}' "$NAME"
done

plan_template ai_rules/globalRules.md templates/install/ai_rules/globalRules.md '{{PROJECT_NAME}}' "$NAME"
plan_template ai_rules/context_map.md templates/install/ai_rules/context_map.md '{{PROJECT_NAME}}' "$NAME"
plan_template ai_rules/updated_rules.md templates/install/ai_rules/updated_rules.md '{{PROJECT_NAME}}' "$NAME"
plan_template ai_rules/rules/core.md templates/install/ai_rules/rules/core.md '{{PROJECT_NAME}}' "$NAME"
plan_template ai_rules/rules/context_management.md templates/install/ai_rules/rules/context_management.md '{{PROJECT_NAME}}' "$NAME"
plan_template ai_rules/rules/frequent_rules.md templates/install/ai_rules/rules/frequent_rules.md '{{PROJECT_NAME}}' "$NAME"
plan_template learning/NOTES.md templates/install/learning/NOTES.md '{{PROJECT_NAME}}' "$NAME"

# Stage only existing Spec Harness-owned files. Never delete target content or refresh over it.
shopt -s nullglob
for source in "$SYS_DIR"/agents/sdd-*.md; do
  rel=".claude/agents/${source##*/}"
  plan_copy "$rel" "$source"
  PENDING+=("$rel (generic role remains unbound)")
done
for source in "$SYS_DIR"/commands/*.md; do
  [ "${source##*/}" = sdd.md ] && continue
  plan_copy ".claude/commands/spec-harness/${source##*/}" "$source"
done
plan_copy .claude/commands/sdd.md "$SYS_DIR/commands/sdd.md"
plan_copy .agents/skills/sdd/SKILL.md "$SYS_DIR/templates/install/agents-skill-sdd.md"
for method in ponytail grill-me package-finder skill-finder; do
  plan_copy ".agents/skills/spec-harness-$method/SKILL.md" "$SYS_DIR/skills/spec-harness-$method/SKILL.md"
done
for method in architecture performance packages tech; do
  plan_copy ".claude/spec-harness/methods/spec-harness-${method}.md" "$SYS_DIR/templates/project-skills/spec-harness-${method}.md"
done

for skill_dir in "$SYS_DIR"/skills/spec-harness*; do
  case "${skill_dir##*/}" in spec-harness-architecture|spec-harness-performance|spec-harness-packages) continue ;; esac
  if [ -f "$skill_dir" ]; then
    plan_copy ".claude/skills/${skill_dir##*/}" "$skill_dir"
  elif [ -d "$skill_dir" ]; then
    while IFS= read -r -d '' source; do
      relative=${source#"$SYS_DIR/skills/"}
      plan_copy ".claude/skills/$relative" "$source"
    done < <(find "$skill_dir" -type f -print0)
  fi
done

for source in "${PLAN_SRCS[@]}"; do
  if [ ! -f "$source" ]; then echo "missing installer source: $source; no target files were written." >&2; exit 1; fi
done

check_destination() {
  local rel=$1 current=$ABS component i last
  local -a parts=()
  IFS=/ read -r -a parts <<<"$rel"
  last=$((${#parts[@]} - 1))
  for ((i = 0; i <= last; i++)); do
    component=${parts[$i]}
    [ -n "$component" ] || continue
    current="$current/$component"
    if [ -L "$current" ]; then
      echo "refusing symlink in installer destination: $current" >&2
      return 1
    fi
    if [ -e "$current" ]; then
      if [ "$i" -lt "$last" ] && [ ! -d "$current" ]; then
        echo "refusing non-directory path component: $current" >&2
        return 1
      fi
      if [ "$i" -eq "$last" ] && [ ! -f "$current" ]; then
        echo "refusing non-file destination collision: $current" >&2
        return 1
      fi
    fi
  done
}

check_directory() {
  local rel=$1 current=$ABS component
  local -a parts=()
  IFS=/ read -r -a parts <<<"$rel"
  for component in "${parts[@]}"; do
    [ -n "$component" ] || continue
    current="$current/$component"
    if [ -L "$current" ]; then
      echo "refusing symlink in installer directory: $current" >&2
      return 1
    fi
    if [ -e "$current" ] && [ ! -d "$current" ]; then
      echo "refusing non-directory collision: $current" >&2
      return 1
    fi
  done
}

# Validate every destination before the first target write.
for rel in "${INSTALL_DIRS[@]}"; do
  check_directory "$rel" || { echo "preflight failed; target was not modified." >&2; exit 2; }
done
for rel in "${PLAN_RELS[@]}"; do
  check_destination "$rel" || { echo "preflight failed; target was not modified." >&2; exit 2; }
done

for rel in "${INSTALL_DIRS[@]}"; do
  if ! mkdir -p "$ABS/$rel"; then echo "cannot create $rel; target may be partially staged." >&2; exit 1; fi
done
for rel in "${PLAN_RELS[@]}"; do
  case "$rel" in */*) parent=${rel%/*}; mkdir -p "$ABS/$parent" || { echo "cannot create directory for $rel" >&2; exit 1; } ;; esac
done

# Recheck after directory creation so a redirected path cannot receive staged files.
for rel in "${INSTALL_DIRS[@]}"; do
  check_directory "$rel" || { echo "preflight failed before file copy; no planned files were copied." >&2; exit 2; }
done
for rel in "${PLAN_RELS[@]}"; do
  check_destination "$rel" || { echo "preflight failed before file copy; no planned files were copied." >&2; exit 2; }
done

for ((i = 0; i < ${#PLAN_RELS[@]}; i++)); do
  rel=${PLAN_RELS[$i]}
  expected=${PLAN_SRCS[$i]}
  destination="$ABS/$rel"
  check_destination "$rel" || { echo "preflight failed before copying $rel; no further files were copied." >&2; exit 2; }
  if [ -f "$destination" ]; then
    PRESERVED+=("$rel")
    if ! cmp -s "$expected" "$destination"; then CONFLICTS+=("$rel"); fi
  else
    if ! cp -p "$expected" "$destination"; then
      echo "copy failed for $rel; target may be partially staged." >&2
      exit 1
    fi
    ADDED+=("$rel")
  fi
done

for skill in architecture performance packages; do
  rel=".claude/skills/spec-harness-${skill}/SKILL.md"
  if [ -e "$ABS/$rel" ] || [ -L "$ABS/$rel" ]; then
    PENDING+=("$rel (reserved project skill already exists; preserve and report CONFLICT/PENDING during init)")
  fi
done
PENDING+=(".claude/skills/ (shared skills are staged; project-specific skills and source bindings remain pending until init review)")

print_paths() {
  local label=$1 item
  shift
  printf '  %s paths:\n' "$label"
  if [ "$#" -eq 0 ]; then printf '    (none)\n'; return; fi
  for item in "$@"; do printf '    - %s\n' "$item"; done
}

printf 'Spec Harness install\n'
printf '  target        : %s\n' "$ABS"
printf '  mode          : %s\n' "$MODE"
printf '  project       : %s\n' "$NAME"
printf '  status        : PENDING\n'
printf '  exit contract : 0 = files staged, setup still PENDING; 2 = invalid input or unsafe path\n'
print_paths ADDED "${ADDED[@]}"
print_paths PRESERVED "${PRESERVED[@]}"
print_paths CONFLICTS "${CONFLICTS[@]}"
print_paths PENDING "${PENDING[@]}"
if [ "${#CONFLICTS[@]}" -gt 0 ]; then
  printf 'CONFLICTS: your existing files were kept unchanged. If AGENTS.md or CLAUDE.md is listed, add the block from step 3 of https://github.com/chohra-med/spec-harness-oss/blob/main/docs/GETTING-STARTED.md so your client loads the harness.\n'
fi
printf 'Next: run /sdd init for source-grounded rules/roles/skills; create feature goals under specs/<feature>/goal.md.\n'
exit 0
