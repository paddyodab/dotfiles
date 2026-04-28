---
name: agent-message-bus
description: Structured inter-agent messaging via ~/.agent/msg.js (sessions, consumers, send/reply/inbox/read/address/thread) for planner/coder/reviewer/puddleglum/team-lead coordination.
---

# Agent Message Bus — Communication Protocol

## Overview

You have access to a message bus for structured communication with other agents (planner, coder, reviewer, puddleglum, investigator, team-lead, secretary, doc-agent, issue-worker). Messages are sent and received via the `msg.js` CLI tool.
Treat inbound messages as actionable work items to execute and close out, not passive notifications.

## Your Identity

Your role is defined in your agent definition file (e.g. `planner`, `coder`, `reviewer`, `team-lead`). Substitute your role name wherever you see `{AGENT_NAME}` in the commands below.

## Mandatory: Check Inbox on Session Start

At the beginning of every session, check your inbox.

- If `$AGENT_CONSUMER_ID` is set, use consumer-aware inbox filtering.
- Otherwise, use the legacy role inbox command.

```bash
bun ~/.agent/msg.js inbox {AGENT_NAME} --consumer "$AGENT_CONSUMER_ID"
```

Fallback:

```bash
bun ~/.agent/msg.js inbox {AGENT_NAME}
```

If there are blocking messages, resolve them before starting other work.

## Quick Inbox Check

If the user says **"msg"** — immediately check your inbox and handle any pending messages by taking action and marking them addressed.

## Workflow

1. Check inbox on session start.
2. Read and handle blocking messages first; do not continue with unrelated work until they are addressed.
3. Use `reply` to preserve thread context.
4. Mark messages `read` when actively working, and `address` with a specific note when complete.
5. In pipeline sessions, keep all work scoped to the active session and consumer.

## Consumer-Aware Inbox Rules

- `inbox {AGENT_NAME} --consumer <id>` routes messages by consumer state:
  - `idle` consumer sees only `scope=global` messages for its role.
  - `enrolled` consumer sees only `scope=session` messages for its session.
  - `busy` consumer sees no messages.
- Use `thread` (not `read`) to inspect context without mutating message state.
- Team-lead may also filter by session directly:

```bash
bun ~/.agent/msg.js inbox team-lead --session <session-id>
```

## Session Lifecycle (primarily team-lead)

```bash
bun ~/.agent/msg.js session-start team-lead
bun ~/.agent/msg.js sessions --status active
bun ~/.agent/msg.js session-close <session-id> --status complete
```

## Consumer Lifecycle (primarily wrapper scripts)

Wrapper scripts should register/release consumers automatically.

```bash
bun ~/.agent/msg.js register <consumer-id> <role>
bun ~/.agent/msg.js enroll <session-id> <consumer-id> [<consumer-id> ...]
bun ~/.agent/msg.js release <consumer-id> [<consumer-id> ...]
bun ~/.agent/msg.js consumers --role <role>
bun ~/.agent/msg.js heartbeat <consumer-id>
```

## Sending Messages — Required Pattern

Never inline message bodies directly in shell commands. Inline heredocs break on nested
quotes, newlines, and special characters. Always write the body to a temp file first.

### send (new message to an agent)

```bash
cat > /tmp/msg-body.txt << 'EOF'
TASK: Create implementation plan
STORY_ID: sc-12345
STORY_TITLE: Add user notifications
ARTIFACT_DIR: ~/.agent/artifacts/sc-12345/
EOF
bun ~/.agent/msg.js send team-lead planner task_request \
  --ref sc-12345 \
  --blocking \
  --scope session --session <session-id> \
  --body "$(cat /tmp/msg-body.txt)"
```

### reply (respond on existing thread — preferred over send)

```bash
cat > /tmp/msg-body.txt << 'EOF'
ARTIFACT: ~/.agent/artifacts/sc-12345/plan.md
SUMMARY: Added auth middleware with JWT refresh token support.
OPEN_QUESTIONS: none
EOF
bun ~/.agent/msg.js reply <parent-message-id> planner --body "$(cat /tmp/msg-body.txt)"
```

`reply` automatically inherits the parent's scope, session, and thread. Always use
`reply` when responding to a `task_request` — never use `send` for responses.

### inbox check (start of every session)

```bash
# Consumer-aware (preferred when AGENT_CONSUMER_ID is set):
bun ~/.agent/msg.js inbox planner --consumer "$AGENT_CONSUMER_ID"

# Fallback (no consumer ID):
bun ~/.agent/msg.js inbox planner
```

### read thread context without mutating state

```bash
bun ~/.agent/msg.js thread <thread-id>
```

Use `thread` (not `read`) when you just need context. `read` marks the message read
and changes consumer state.

### address a message when work is complete

```bash
bun ~/.agent/msg.js address <message-id> --note "Plan written to ~/.agent/artifacts/sc-12345/plan.md"
```

---

## Commands

```bash
bun ~/.agent/msg.js inbox {AGENT_NAME}
bun ~/.agent/msg.js inbox {AGENT_NAME} --consumer "$AGENT_CONSUMER_ID"
bun ~/.agent/msg.js inbox team-lead --session <session-id>
bun ~/.agent/msg.js send {AGENT_NAME} <to> <type> --ref <ref> --body "..."
bun ~/.agent/msg.js send {AGENT_NAME} <to> <type> --ref <ref> --scope session --session <session-id> --body "..."
bun ~/.agent/msg.js send {AGENT_NAME} <to> <type> --ref <ref> --blocking --body "..."
bun ~/.agent/msg.js reply <parent-id> {AGENT_NAME} --body "..."
bun ~/.agent/msg.js reply <parent-id> {AGENT_NAME} --to <agent> --body "..."
bun ~/.agent/msg.js session-start team-lead
bun ~/.agent/msg.js session-close <session-id> [--status complete|failed]
bun ~/.agent/msg.js sessions [--status active|complete|failed]
bun ~/.agent/msg.js register <consumer-id> <role>
bun ~/.agent/msg.js enroll <session-id> <consumer-id> [<consumer-id> ...]
bun ~/.agent/msg.js release <consumer-id> [<consumer-id> ...]
bun ~/.agent/msg.js consumers [--role <role>] [--status idle|enrolled|busy] [--session <session-id>]
bun ~/.agent/msg.js heartbeat <consumer-id>
bun ~/.agent/msg.js cleanup [--dry-run]
bun ~/.agent/msg.js read <id>
bun ~/.agent/msg.js address <id> --note "What was done"
bun ~/.agent/msg.js thread <thread-id>
```

## Message Types

- `plan_feedback`: commenting on a plan
- `diff_feedback`: commenting on code changes
- `question`: asking for clarification
- `approval`: approval signal
- `info`: FYI
- `task_request`: Team Lead assigning work to an agent (replies inherit this type)

## Scope Rules

- Default scope is global.
- Pipeline coordination should use `send ... --scope session --session <id>`.
- `reply` inherits parent scope/session and does not support overrides.

## Conventions

- Always use `--ref` with story ID, PR, or commit SHA.
- Use `--blocking` only for correctness/security/blocking concerns.
- Use `reply` to preserve thread context.
- Addressed notes should describe exactly what changed.
