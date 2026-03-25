---
description: Show the currently active thought stream and its mission
---

Show the currently active thought stream and its mission. Quick diagnostic without loading full context.

## What to do

1. **Find active stream**
   - Check `thoughts/CURRENT.md`
   - If it's a symlink: resolve to get stream name
   - If it's a file: read metadata to get stream name
   - If doesn't exist: report "No active stream"

2. **Read stream content**
   - Read `thoughts/streams/{name}.md`
   - Extract mission (first line after "## Mission")
   - Extract focus (first line after "## Current Focus")
   - Get file modification date

3. **List available streams**
   - Scan `thoughts/streams/` directory
   - List all `.md` files (without extension)

4. **Display formatted output**
   - Show compact box with stream info
   - Show list of available streams
   - Mark current stream with "(current)"

## Error handling

- No active stream → "No active stream. Run /new-stream to create one."
- Stream file missing → "Active stream pointer exists but file is missing. Recreate with /new-stream."
