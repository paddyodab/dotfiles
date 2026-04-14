---
name: agent-message-bus
description: Structured inter-agent messaging via ~/.agent/msg.js (sessions, consumers, send/reply/inbox/read/address/thread) for planner/coder/reviewer/puddleglum/team-lead coordination.
---

# Agent Message Bus — Communication Protocol

## Overview

You have access to a message bus for structured communication with other agents (planner, coder, reviewer, puddleglum, team-lead). Messages are sent and received via the `msg.js` CLI tool.
Treat inbound messages as actionable work items to execute and close out, not passive notifications.

## Your Identity

You are the **{AGENT_NAME}** agent. Replace `{AGENT_NAME}` with your role when using commands.

## Mandatory: Check Inbox on Session Start

At the beginning of every session, check your inbox.

- If `$AGENT_CONSUMER_ID` is set, use consumer-aware inbox filtering.
- Otherwise, use the legacy role inbox command.

```bash
node ~/.agent/msg.js inbox {AGENT_NAME} --consumer "$AGENT_CONSUMER_ID"
```

Fallback:

```bash
node ~/.agent/msg.js inbox {AGENT_NAME}
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
node ~/.agent/msg.js inbox team-lead --session <session-id>
```

## Session Lifecycle (primarily team-lead)

```bash
node ~/.agent/msg.js session-start team-lead
node ~/.agent/msg.js sessions --status active
node ~/.agent/msg.js session-close <session-id> --status complete
```

## Consumer Lifecycle (primarily wrapper scripts)

Wrapper scripts should register/release consumers automatically.

```bash
node ~/.agent/msg.js register <consumer-id> <role>
node ~/.agent/msg.js enroll <session-id> <consumer-id> [<consumer-id> ...]
node ~/.agent/msg.js release <consumer-id> [<consumer-id> ...]
node ~/.agent/msg.js consumers --role <role>
node ~/.agent/msg.js heartbeat <consumer-id>
```

## Commands

```bash
node ~/.agent/msg.js inbox {AGENT_NAME}
node ~/.agent/msg.js inbox {AGENT_NAME} --consumer "$AGENT_CONSUMER_ID"
node ~/.agent/msg.js inbox team-lead --session <session-id>
node ~/.agent/msg.js send {AGENT_NAME} <to> <type> --ref <ref> --body "..."
node ~/.agent/msg.js send {AGENT_NAME} <to> <type> --ref <ref> --scope session --session <session-id> --body "..."
node ~/.agent/msg.js send {AGENT_NAME} <to> <type> --ref <ref> --blocking --body "..."
node ~/.agent/msg.js reply <parent-id> {AGENT_NAME} --body "..."
node ~/.agent/msg.js reply <parent-id> {AGENT_NAME} --to <agent> --body "..."
node ~/.agent/msg.js session-start team-lead
node ~/.agent/msg.js session-close <session-id> [--status complete|failed]
node ~/.agent/msg.js sessions [--status active|complete|failed]
node ~/.agent/msg.js register <consumer-id> <role>
node ~/.agent/msg.js enroll <session-id> <consumer-id> [<consumer-id> ...]
node ~/.agent/msg.js release <consumer-id> [<consumer-id> ...]
node ~/.agent/msg.js consumers [--role <role>] [--status idle|enrolled|busy] [--session <session-id>]
node ~/.agent/msg.js heartbeat <consumer-id>
node ~/.agent/msg.js cleanup [--dry-run]
node ~/.agent/msg.js read <id>
node ~/.agent/msg.js address <id> --note "What was done"
node ~/.agent/msg.js thread <thread-id>
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
