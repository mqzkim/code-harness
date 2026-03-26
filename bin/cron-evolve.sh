#!/bin/bash
# code-harness cron script
# Runs structural evaluation + Claude evolution on all workspace projects
#
# Setup (crontab -e):
#   0 10 * * 1  /path/to/code-harness/bin/cron-evolve.sh
#
# Or Windows Task Scheduler:
#   Program: bash
#   Arguments: /c/Users/my/workspace/code-harness/bin/cron-evolve.sh

set -e

HARNESS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE="$(dirname "$HARNESS_DIR")"
LOG_DIR="$HARNESS_DIR/logs"
mkdir -p "$LOG_DIR"

DATE=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/evolve-$DATE.log"

echo "[$DATE] Starting code-harness evolution cycle" | tee -a "$LOG_FILE"
echo "Workspace: $WORKSPACE" | tee -a "$LOG_FILE"

# Find all projects (skip code-harness itself)
for PROJECT_DIR in "$WORKSPACE"/*/; do
  PROJECT_NAME=$(basename "$PROJECT_DIR")

  if [ "$PROJECT_NAME" = "code-harness" ]; then
    continue
  fi

  # Skip if no source files
  if [ ! -d "$PROJECT_DIR/src" ] && [ ! -d "$PROJECT_DIR/lib" ] && [ ! -d "$PROJECT_DIR/scripts" ]; then
    continue
  fi

  echo "" | tee -a "$LOG_FILE"
  echo "=== Processing: $PROJECT_NAME ===" | tee -a "$LOG_FILE"

  # Step 1: Evaluate
  node "$HARNESS_DIR/bin/cli.js" evaluate --target "$PROJECT_DIR" 2>&1 | tee -a "$LOG_FILE"

  # Step 2: Generate evolution prompt
  node "$HARNESS_DIR/bin/cli.js" evolve --target "$PROJECT_DIR" 2>&1 | tee -a "$LOG_FILE"

  # Step 3: Run Claude evolution (if prompt was generated)
  PROMPT_FILE="$PROJECT_DIR/.harness-evolve-prompt.md"
  if [ -f "$PROMPT_FILE" ]; then
    echo "Running Claude evolution for $PROJECT_NAME..." | tee -a "$LOG_FILE"

    cd "$PROJECT_DIR"

    # Invoke Claude CLI with the evolution prompt
    claude -p "$(cat "$PROMPT_FILE")" --dangerously-skip-permissions 2>&1 | tee -a "$LOG_FILE" || {
      echo "Claude evolution failed for $PROJECT_NAME" | tee -a "$LOG_FILE"
    }

    # Cleanup prompt file
    rm -f "$PROMPT_FILE"

    cd "$WORKSPACE"
  fi

  echo "=== Done: $PROJECT_NAME ===" | tee -a "$LOG_FILE"
done

echo "" | tee -a "$LOG_FILE"
echo "[$DATE] Evolution cycle complete" | tee -a "$LOG_FILE"
