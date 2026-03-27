# Note That

Capture current session state to the active thought stream before `/clear`. Preserves mission continuity.

## Instructions

### 1. Verify Active Stream

Use the Read tool to check if `thoughts/CURRENT.md` exists in the repo root (the current working directory). This is a symlink to the active stream file.

- If it doesn't exist: respond "No active stream. Create one with `/new-stream` first." and stop.
- If it exists: read it to get the current stream content and note the symlink target.

### 2. Gather State from Conversation

Review the current session and synthesize:

| Section | What to Capture |
|---------|-----------------|
| Mission | What we're accomplishing (usually stable from existing stream) |
| Current Focus | Single most important next item (ONE thing) |
| Decisions Made | Key choices with brief rationale |
| Progress | Completed items (✅), Blocked items |
| What We Tried | Failures and partial successes (critical for not repeating mistakes!) |
| Working Context | Files touched, branch, useful commands |
| Open Questions | Things to verify, UNCONFIRMED assumptions |

**Rules:**
- Current Focus must be ONE thing, not a list
- "What We Tried" prevents repeating mistakes — always capture failures
- Preserve decisions from the existing stream content unless superseded

### 3. Write Updated Stream

Use the Write tool to update the stream file at `thoughts/CURRENT.md` (which follows the symlink to the actual stream file). Use this format:

```markdown
# {Stream Title}
Updated: {YYYY-MM-DD}

## Mission
{mission}

## Current Focus
{focus - ONE thing}

## Decisions Made
- **{Decision}**: {what} - {why}

## Progress
- ✅ {completed items}
- Blocked: {blocked items}

## What We Tried
{attempts, especially failures}

## Working Context
- Files: {relevant files}
- Branch: {git branch}
- Commands: {useful commands}

## Open Questions
- {things to verify}
- UNCONFIRMED: {assumptions}
```

### 4. Confirm

Respond with:

```
Stream updated. Ready for /clear.

The SessionStart hook will automatically restore context when you return.
```
