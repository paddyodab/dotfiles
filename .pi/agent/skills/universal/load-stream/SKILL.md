---
name: load-stream
description: Load the active thought stream and project persona into the session. Makes the agent mission-aware by injecting full context from thoughts/CURRENT.md and .pi/SELF.md.
argument-hint: "[optional: stream name to load specific stream]"
allowed-tools: read bash
---

# /load-stream

Load the active thought stream and project persona into the session. Makes you "mission aware" by injecting full context.

## What to do

### Step 1: Load project persona

Check if `.pi/SELF.md` exists using the read tool:
- If yes: Read and output its content
- This provides communication preferences, evaluation framework, etc.

### Step 2: Get active stream

Use bash to check `thoughts/CURRENT.md`:
```bash
if [ -L "thoughts/CURRENT.md" ]; then
    # It's a symlink - resolve it
    readlink "thoughts/CURRENT.md"
elif [ -f "thoughts/CURRENT.md" ]; then
    # It's a file - extract stream name from first line
    head -1 "thoughts/CURRENT.md" | sed 's/^# //'
else
    echo "NO_CURRENT"
fi
```

If result is "NO_CURRENT":
```
No active stream. Run /new-stream to create one.
```

### Step 3: Load stream content

Get target stream file path: `thoughts/streams/{name}.md`

Use the read tool to read the full stream file and output it so it becomes session context.

### Step 4: Confirm success

Show:
```
Context loaded:
- Stream: {name}
- Mission: {mission}
- Focus: {focus}

I'm now mission aware.
```

## Error handling

- No CURRENT.md → "No active stream. Run /new-stream to create one."
- Stream file missing → "Active stream file missing. Context incomplete."
- No .pi/SELF.md → Continue without persona (just load stream)

## Integration

This is typically called automatically by:
- /skill:new-stream (after creating)
- /skill:switch-stream (after switching)

You can also call it manually when you need to refresh context.
