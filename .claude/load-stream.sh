#!/bin/bash
# Load personal context + active thought stream into Claude Code session
# Wired via SessionStart hook — stdout becomes session context

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# Load personal context
if [ -f "$ROOT/.claude/SELF.md" ]; then
  echo "=== Personal Context ==="
  cat "$ROOT/.claude/SELF.md"
  echo ""
fi

# Load active thought stream
STREAM="$ROOT/thoughts/CURRENT.md"
if [ -L "$STREAM" ] && [ -f "$STREAM" ]; then
  STREAM_NAME=$(basename "$(readlink "$STREAM")" .md)
  echo "=== Active Stream: $STREAM_NAME ==="
  cat "$STREAM"
  echo ""
  echo "Stream loaded. I am mission-aware."
fi
