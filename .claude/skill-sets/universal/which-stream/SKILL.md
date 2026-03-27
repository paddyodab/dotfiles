---
description: Show current stream identity and mission
argument-hint: ""
allowed-tools:
  - Bash
  - Read
---

# Which Stream

Quick status check: which stream is active and what's the mission.

## Instructions

### 1. Get Active Stream

```bash
readlink thoughts/CURRENT.md
```

If there is no symlink or the target does not exist, report: "No active stream. Run /new-stream to create one." and stop.

### 2. Read Stream Content

Read `thoughts/CURRENT.md`. Extract the mission (text under `## Mission`) and current focus (text under `## Current Focus`).

### 3. Display

Show a compact summary:

```
Stream: {name without .md}
Mission: {mission}
Focus: {current focus}
```

Keep it brief. This is a quick peek, not a full context load.
