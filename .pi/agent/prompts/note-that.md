---
description: Capture current session state to the active thought stream before session reset. Preserves mission continuity.
---

Capture current session state to the active thought stream. Preserves mission continuity.

## What to Capture

Synthesize the conversation into structured state:

| Section | What to Capture |
|---------|-----------------|
| Mission | What we're accomplishing (usually stable) |
| Current Focus | Single most important next item (ONE thing) |
| Decisions Made | Key choices with brief rationale |
| Progress | Completed items (✅), Blocked items |
| What We Tried | Failures and partial successes (critical!) |
| Working Context | Files touched, branch, useful commands |
| Open Questions | Things to verify, UNCONFIRMED assumptions |

## Important Rules

- **Current Focus must be ONE thing**, not a list
- **"What We Tried" prevents repeating mistakes** - capture failures!
- Keep it concise but specific

## What to do

1. **Verify active stream**
   - Check `thoughts/CURRENT.md` exists
   - Get target stream file path
   - If no active stream: "No active stream. Run /new-stream first."

2. **Synthesize conversation**
   - Review entire session
   - Extract or infer each section:
     - **Mission**: What's the overall goal?
     - **Current Focus**: What's the ONE next thing to do?
     - **Decisions**: What choices were made and why?
     - **Progress**: What got done? What's blocked?
     - **What We Tried**: What failed or partially worked?
     - **Working Context**: Relevant files, branch, commands
     - **Open Questions**: What needs verification?

3. **Format as markdown**
   - Use standard template
   - Update "Updated: {YYYY-MM-DD}" date
   - Keep focus to ONE item
   - Capture failures in "What We Tried"

4. **Write to stream file**
   - Overwrite `thoughts/streams/{name}.md`
   - Preserve file permissions

5. **Confirm success**
   - Show: "Stream updated: {name}"
   - Show: "Context will auto-restore when you return with /load-stream."

## Error handling

- No active stream → "No active stream. Run /new-stream first."
- Write fails → Report error, suggest checking permissions

## Best Practices

Call this before ending a session or when switching tasks. The captured state lets you resume seamlessly later.
