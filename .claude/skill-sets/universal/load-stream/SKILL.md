---
description: Load the active thought stream and personal context into the session
argument-hint: ""
allowed-tools:
  - Bash
  - Read
---

# Load Stream

Load full context (personal profile + active stream) into the current session.

## Instructions

### 1. Load Personal Context

Read `.claude/SELF.md` from the repo root. Output its content so it becomes part of session context. If the file does not exist, skip silently.

### 2. Check for Active Stream

Run:

```bash
readlink thoughts/CURRENT.md
```

If there is no symlink or the target does not exist, report: "No active stream. Run /new-stream to create one." and stop.

### 3. Load Stream Content

Read `thoughts/CURRENT.md` (follows the symlink automatically). Output the full content so it becomes part of session context.

### 4. Confirm

Extract the mission (text under `## Mission`) and current focus (text under `## Current Focus`) from the stream content, then report:

```
Context loaded:
- Stream: {filename from symlink, without .md}
- Mission: {mission}
- Focus: {current focus}

I'm now mission aware.
```
