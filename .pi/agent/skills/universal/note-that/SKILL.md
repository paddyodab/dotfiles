---
name: note-that
description: Capture current session state to the active thought stream before session reset. Preserves mission continuity by updating progress, decisions, and focus in thoughts/streams/{active}.md.
argument-hint: "[optional: quick note to append]"
allowed-tools: read bash interview edit write
---

# /note-that

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

### Step 1: Verify active stream

Use bash to check `thoughts/CURRENT.md`:
```bash
if [ -L "thoughts/CURRENT.md" ]; then
    readlink "thoughts/CURRENT.md"
elif [ -f "thoughts/CURRENT.md" ]; then
    head -1 "thoughts/CURRENT.md" | sed 's/^# //'
else
    echo "NO_CURRENT"
fi
```

If result is "NO_CURRENT":
```
No active stream. Run /skill:new-stream first.
```

### Step 2: Read current stream

Use read tool to read `thoughts/streams/{name}.md` to get existing content.

### Step 3: Synthesize conversation

Review entire session and extract or infer each section:
- **Mission**: What's the overall goal? (usually from existing stream)
- **Current Focus**: What's the ONE next thing to do?
- **Decisions**: What choices were made and why?
- **Progress**: What got done? What's blocked?
- **What We Tried**: What failed or partially worked?
- **Working Context**: Relevant files, branch, commands
- **Open Questions**: What needs verification?

### Step 4: Use interview to confirm/update key fields

```json
{
  "questions": [
    {
      "id": "current_focus",
      "type": "text",
      "question": "Current Focus (ONE thing - what is the most important next step?):"
    },
    {
      "id": "progress",
      "type": "text",
      "question": "What progress was made? (comma-separated list, will be formatted as ✅ items)"
    },
    {
      "id": "blocked",
      "type": "text",
      "question": "Anything blocked? (comma-separated list, empty if nothing blocked)"
    },
    {
      "id": "tried",
      "type": "text",
      "question": "What was tried that failed or partially worked? (prevents repeating mistakes)"
    },
    {
      "id": "open_questions",
      "type": "text",
      "question": "Any open questions or unconfirmed assumptions?"
    }
  ]
}
```

### Step 5: Write to stream file

Use the write tool to overwrite `thoughts/streams/{name}.md` with updated content:

- Update "Updated: {YYYY-MM-DD}" to today's date
- Keep the Mission (usually stable)
- Set Current Focus to the ONE item from interview
- Add new decisions to Decisions Made list
- Format Progress with ✅ for completed items
- Add Blocked items if any
- Append to What We Tried (don't lose previous attempts!)
- Update Working Context (files, branch, commands)
- Add/update Open Questions

### Step 6: Confirm success

Show:
```
Stream updated: {name}
Context will auto-restore when you return with /skill:load-stream.
```

## Error handling

- No active stream → "No active stream. Run /skill:new-stream first."
- Write fails → Report error, suggest checking permissions

## Best Practices

Call this before ending a session or when switching tasks. The captured state lets you resume seamlessly later.
