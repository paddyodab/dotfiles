---
description: Switch to a different thought stream
---

Switch to a different thought stream. Loads its full context so you're immediately mission-aware.

## What to do

1. **Get available streams**
   - Scan `thoughts/streams/` for all `.md` files
   - Get current active stream from `thoughts/CURRENT.md`

2. **Get target stream**
   - If argument provided: use it (convert to kebab-case)
   - If no argument: AskUserQuestion with list of available streams
     - Mark current stream with "(current)"
     - Include "Create new stream" option (suggests /new-stream)

3. **Validate stream exists**
   - Check `thoughts/streams/{name}.md` exists
   - If not: Show error with available streams list

4. **Update CURRENT.md**
   - If symlinks supported: Create new symlink
   - If not: Update metadata in CURRENT.md file

5. **Load and display context**
   - Read full stream content
   - Output it so it becomes session context
   - Confirm: "Switched to stream: {name}"
   - Confirm: "Context loaded. I'm now mission aware."

## Error handling

- Stream doesn't exist → Show available streams, ask user to pick
- Permission denied → Report error
