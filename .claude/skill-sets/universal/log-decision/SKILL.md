---
name: log-decision
description: Capture a decision trace from the current session to the central KB. Zero-friction — extracts domain, choice, alternatives, why, and stage from context without asking.
argument-hint: "[optional: which decision if multiple happened]"
model: haiku
allowed-tools:
  - AskUserQuestion
  - Bash
---

# /log-decision

Capture a decision trace while context is fresh. Reads the session, extracts the five fields, confirms with you, writes to the central KB as JSONL.

## Variables

- `brief description` (optional): Disambiguates which decision to capture when multiple happened in the session

## Instructions

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

If `why` cannot be inferred from the conversation, ask using AskUserQuestion:
```
Why did you choose {chose}? (one sentence)
```

### Step 2: Confirm

Show the entry and ask using AskUserQuestion:

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

```bash
DATE=$(date +%Y-%m-%d)
PROJECT=$(basename $(git rev-parse --show-toplevel 2>/dev/null) 2>/dev/null || echo "unknown")
KB="${KB_PATH:-$HOME/my-projects/GitHub/central-kb-for-remote-skills}"
mkdir -p "$KB/decisions"
```

Construct the JSONL entry — use the extracted values, JSON-encode strings properly:

```bash
echo "{\"type\":\"decision\",\"domain\":\"DOMAIN\",\"chose\":\"CHOSE\",\"alternatives\":[ALTERNATIVES_JSON],\"why\":\"WHY\",\"stage\":\"STAGE\",\"project\":\"$PROJECT\",\"date\":\"$DATE\",\"source\":\"session\"}" >> "$KB/decisions/decisions.jsonl"
```

### Step 4: Commit and Push

```bash
cd "$KB" && git add decisions/decisions.jsonl && git commit -m "decision: DOMAIN — CHOSE" && git push
```

If push fails (no remote, offline), skip silently — the entry is written locally and will sync next push.

### Step 5: Confirm

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
