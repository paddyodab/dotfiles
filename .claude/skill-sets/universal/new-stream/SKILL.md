---
description: Create a new thought stream and switch to it
argument-hint: "[stream-name]"
allowed-tools:
  - Bash
  - Read
  - Write
---

# New Stream

Create a new thought stream file and switch the CURRENT.md symlink to it.

## Instructions

### 1. Get Stream Name

If the user provided a name as an argument, use it. Convert to kebab-case (lowercase, spaces/underscores to hyphens).

If no name was provided, ask: "What should we call this stream?" Suggest contextual names based on the conversation.

### 2. Get Mission

Ask: "What's the mission for this stream?" Suggest options based on the conversation. If the user declines, use "(to be defined)".

### 3. Ensure Directory Exists

```bash
mkdir -p thoughts/streams
```

### 4. Check for Conflicts

If `thoughts/streams/{name}.md` already exists, tell the user and ask if they want to switch to it instead (use /switch-stream) or pick a different name.

### 5. Create Stream File

Convert the kebab-case name to a title (capitalize words, hyphens to spaces). Get today's date as YYYY-MM-DD.

Write `thoughts/streams/{name}.md` with this template:

```markdown
# {Title}
Updated: {YYYY-MM-DD}

## Mission
{mission}

## Current Focus
Getting started

## Decisions Made
- (none yet)

## Progress
- (none yet)
- Blocked: (none)

## What We Tried
- (nothing yet)

## Working Context
- Files:
- Branch:
- Commands:

## Open Questions
-
```

### 6. Update Symlink

```bash
ln -sf streams/{name}.md thoughts/CURRENT.md
```

### 7. Confirm

Report: "Created and switched to stream: {name}"

Then load the stream context by reading `thoughts/CURRENT.md` and `.claude/SELF.md` (if it exists), and confirm you are mission aware.
