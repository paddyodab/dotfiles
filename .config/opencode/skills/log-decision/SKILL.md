---
name: log-decision
description: Capture a decision trace from the current session to the central KB. Zero-friction — extracts domain, choice, alternatives, why, and stage from context without asking.
---

# /log-decision

Capture a decision trace while context is fresh. Reads the session, extracts the five fields, confirms with you, writes to the central KB as JSONL.

## Setup

### Cross-Machine Configuration

This skill uses a central knowledge base (KB) to store decision traces. By default it looks at:
```
~/Documents/GitHub/central-kb-for-remote-skills/
```

**For multi-machine setups:** Set the `KB_PATH` environment variable in your shell config to override the default:

```bash
# In .bashrc, .zshrc, etc.
export KB_PATH="$HOME/Documents/GitHub/central-kb-for-remote-skills"
```

## Variables

- `brief description` (optional): Disambiguates which decision to capture when multiple happened in the session

## Instructions

### Step 0: KB Setup (First Time Only)

Before logging decisions, ensure the central KB is accessible. Check if `KB_PATH` is set or the default KB exists:

```bash
if [ -n "$KB_PATH" ]; then
  echo "KB_PATH is set to: $KB_PATH"
  [ -d "$KB_PATH" ] && echo "KB directory exists" || echo "KB directory does NOT exist"
else
  echo "KB_PATH is not set"
  DEFAULT_KB="$HOME/Documents/GitHub/central-kb-for-remote-skills"
  [ -d "$DEFAULT_KB" ] && echo "Default KB exists at: $DEFAULT_KB" || echo "Default KB does NOT exist at: $DEFAULT_KB"
fi
```

If KB doesn't exist, ask the user how to set it up (default path, custom path, or clone from remote).

### Step 1: Extract from Context

Review the current conversation and identify the most recent non-obvious decision — a choice where alternatives existed and a reason drove the selection.

Extract these five fields:

| Field | What it captures |
|-------|-----------------|
| `domain` | Area of work: `auth`, `testing`, `architecture`, `devops`, `data-model`, `tooling`, `api-design`, etc. |
| `chose` | What was selected or decided |
| `alternatives` | What else was considered (empty array if nothing explicit was weighed) |
| `why` | The reason — most important field. Pull from context. |
| `stage` | Where in the project: `greenfield`, `pre-auth`, `pre-launch`, `post-launch`, `refactor`, `debugging`, `maintenance` |

If `why` cannot be inferred from the conversation, ask the user.

### Step 2: Confirm

Show the entry and ask:

```
Decision to log:

  domain:       {domain}
  chose:        {chose}
  alternatives: {alternatives joined by ", "}
  why:          {why}
  stage:        {stage}

Right? (press enter to save, or describe a correction)
```

### Step 3: Write to KB

```bash
DATE=$(date +%Y-%m-%d)
PROJECT=$(basename $(git rev-parse --show-toplevel 2>/dev/null) 2>/dev/null || echo "unknown")
KB="${KB_PATH:-$HOME/Documents/GitHub/central-kb-for-remote-skills}"
mkdir -p "$KB/decisions"
echo "{\"type\":\"decision\",\"domain\":\"DOMAIN\",\"chose\":\"CHOSE\",\"alternatives\":[ALTERNATIVES_JSON],\"why\":\"WHY\",\"stage\":\"STAGE\",\"project\":\"$PROJECT\",\"date\":\"$DATE\",\"source\":\"session\"}" >> "$KB/decisions/decisions.jsonl"
```

### Step 4: Commit to KB

```bash
cd "$KB" && git add decisions/decisions.jsonl && git commit -m "decision: DOMAIN — CHOSE"
```

### Step 5: Confirm

```
✓ Logged: {domain} → {chose}
  "{why}"
```

## Design Principles

- **Zero input in the common case** — everything pulled from context
- **One question max** — only ask if `why` is absent from the session
- **Confirmation is the safety valve** — you see exactly what gets written before it's committed
- **Local-only** — commit to KB repo, user pushes when ready
- **JSONL format** — one entry per line, grepable, ingestible later

## Example Entry

```jsonl
{"type":"decision","domain":"auth","chose":"cognito","alternatives":["auth0","custom"],"why":"legal requires AWS-native for compliance audit","stage":"pre-launch","project":"client-portal","date":"2026-04-04","source":"session"}
```
