---
description: Load the active thought stream and project persona into the session
---

Load the active thought stream and project persona into the session. Makes you "mission aware" by injecting full context.

## What to do

1. **Load project persona**
   - Check if `.pi/SELF.md` exists
   - If yes: Read and output its content
   - This provides communication preferences, evaluation framework, etc.

2. **Get active stream**
   - Read `thoughts/CURRENT.md` (resolve symlink or read metadata)
   - Get target stream file path: `thoughts/streams/{name}.md`

3. **Load stream content**
   - Read the full stream file
   - Output it so it becomes session context

4. **Confirm success**
   - Show: "Context loaded:"
   - Show: "- Stream: {name}"
   - Show: "- Mission: {mission}"
   - Show: "- Focus: {focus}"
   - Show: "I'm now mission aware."

## Error handling

- No CURRENT.md → "No active stream. Run /new-stream to create one."
- Stream file missing → "Active stream file missing. Context incomplete."
- No .pi/SELF.md → Continue without persona (just load stream)

## Integration

This is typically called automatically by:
- /new-stream (after creating)
- /switch-stream (after switching)

You can also call it manually when you need to refresh context.
