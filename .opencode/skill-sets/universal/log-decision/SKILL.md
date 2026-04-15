---
name: log-decision
description: Capture a decision trace from the current session to the central KB. Zero-friction — extracts domain, choice, alternatives, why, and stage from context without asking.
argument-hint: "[optional: which decision if multiple happened]"
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

This allows the same skill to work across machines with different directory structures.

## Variables

- `brief description` (optional): Disambiguates which decision to capture when multiple happened in the session

## Instructions

### Step 0: KB Setup (First Time Only)

Before logging decisions, ensure the central KB is accessible. Use the bash tool to check:

```bash
if [ -n "$KB_PATH" ]; then
  echo "KB_PATH_SET:$KB_PATH"
  if [ -d "$KB_PATH" ]; then
    echo "KB_EXISTS:yes"
  else
    echo "KB_EXISTS:no"
  fi
else
  echo "KB_PATH_SET:none"
  DEFAULT_KB="$HOME/Documents/GitHub/central-kb-for-remote-skills"
  if [ -d "$DEFAULT_KB" ]; then
    echo "DEFAULT_EXISTS:yes:$DEFAULT_KB"
  else
    echo "DEFAULT_EXISTS:no:$DEFAULT_KB"
  fi
fi
```

**If KB_PATH is not set AND the default KB doesn't exist:**

Ask using the question tool:

```
I need to set up the central knowledge base path for logging decisions.

The KB stores decision traces across all your projects and machines.

Options:
1. Use default: ~/Documents/GitHub/central-kb-for-remote-skills
2. Set a custom path
3. Clone your existing KB from a remote repo

Which option? (1/2/3 or describe your setup)
```

Based on response:

**Option 1 (default):**
Use bash tool: `mkdir -p "$HOME/Documents/GitHub/central-kb-for-remote-skills/decisions"`

**Option 2 (custom path):**
Ask: `What path should I use for the KB? (absolute path)`
Then use bash: `mkdir -p "{provided_path}/decisions"`

**Option 3 (clone existing):**
Ask: `What's the git URL for your KB repo?`
Then use bash: `git clone {url} "$HOME/Documents/GitHub/central-kb-for-remote-skills"`

After setting up the KB directory, ask:
```
Shall I add KB_PATH to your shell config so this works across all sessions?
(This will append to your .bashrc/.zshrc)
```

If yes, use bash to detect the shell and add the export:
```bash
SHELL_CONFIG="$HOME/.$(basename $SHELL)rc"
echo 'export KB_PATH="'$KB'"' >> "$SHELL_CONFIG"
```

### Step 1: Extract from Context

Review the current conversation and identify the most recent non-obvious decision — a choice where alternatives existed and a reason drove the selection. If a `brief description` argument was provided, use it to target the right decision.

Extract these five fields:

| Field | What it captures |
|-------|-----------------|
| `domain` | Area of work: `auth`, `testing`, `architecture`, `devops`, `data-model`, `tooling`, `api-design`, etc. |
| `chose` | What was selected or decided |
| `alternatives` | What else was considered (empty array if nothing explicit was weighed) |
| `why` | The reason — most important field. Pull from context. |
| `stage` | Where in the project: `greenfield`, `pre-auth`, `pre-launch`, `post-launch`, `refactor`, `debugging`, `maintenance` |

If `why` cannot be inferred from the conversation, ask using the question tool:

```
Why did you choose {chose}? (one sentence)
```

### Step 2: Confirm

Show the entry and ask using the question tool:

```
Decision to log:

  domain:       {domain}
  chose:        {chose}
  alternatives: {alternatives joined by ", "}
  why:          {why}
  stage:        {stage}

Right? (press enter to save, or describe a correction)
```

Accept "y", "yes", or empty input as confirmation. If they describe a correction, apply it and re-show before saving.

### Step 3: Write to KB

Determine KB path (already validated in Step 0):

Use the bash tool:

```bash
DATE=$(date +%Y-%m-%d)
PROJECT=$(basename $(git rev-parse --show-toplevel 2>/dev/null) 2>/dev/null || echo "unknown")
KB="${KB_PATH:-$HOME/Documents/GitHub/central-kb-for-remote-skills}"
mkdir -p "$KB/decisions"
```

Construct the JSONL entry — use the extracted values, JSON-encode strings properly:

```bash
echo "{\"type\":\"decision\",\"domain\":\"DOMAIN\",\"chose\":\"CHOSE\",\"alternatives\":[ALTERNATIVES_JSON],\"why\":\"WHY\",\"stage\":\"STAGE\",\"project\":\"$PROJECT\",\"date\":\"$DATE\",\"source\":\"session\"}" >> "$KB/decisions/decisions.jsonl"
```

### Step 4: Commit and Push

Use the bash tool:

```bash
cd "$KB" && git add decisions/decisions.jsonl && git commit -m "decision: DOMAIN — CHOSE" && git push
```

If push fails (no remote, offline), skip silently — the entry is written locally and will sync next push.

### Step 5: Confirm

Report to user:

```
✓ Logged: {domain} → {chose}
  "{why}"

/log-decision to capture another.
```

## Design Principles

- **Zero input in the common case** — everything pulled from context
- **One question max** — only ask if `why` is absent from the session
- **Confirmation is the safety valve** — you see exactly what gets written before it's committed
- **Push is best-effort** — local write always succeeds first
- **JSONL format** — one entry per line, grepable, ingestible into a QMD collection later

## Good Triggers

- You just chose X over Y and there was a real reason
- You overrode a default or a previous pattern
- A constraint (legal, perf, security, team preference) shaped a choice
- You said "just do it" when the agent flagged an alternative — that's a decision worth tracing
- End of session: "was there a non-obvious call in that work?"

## Anti-patterns

- Logging obvious choices with no alternatives (`chose: tabs, why: project standard`)
- Logging after context has faded — run this immediately
- Batching multiple decisions into one entry — one decision per entry

## Example Entry

```jsonl
{"type":"decision","domain":"auth","chose":"cognito","alternatives":["auth0","custom"],"why":"legal requires AWS-native for compliance audit","stage":"pre-launch","project":"client-portal","date":"2026-04-04","source":"session"}
```
