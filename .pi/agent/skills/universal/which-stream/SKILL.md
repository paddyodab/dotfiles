---
name: which-stream
description: Show the currently active thought stream and its mission. Quick diagnostic without loading full context. Lists all available streams with current one marked.
argument-hint: "[none]"
allowed-tools: read bash
---

# /which-stream

Show the currently active thought stream and its mission. Quick diagnostic without loading full context.

## What to do

### Step 1: Find active stream

Use bash to check `thoughts/CURRENT.md`:
```bash
if [ -L "thoughts/CURRENT.md" ]; then
    # It's a symlink - resolve it
    readlink "thoughts/CURRENT.md" | sed 's|streams/||; s|.md||'
elif [ -f "thoughts/CURRENT.md" ]; then
    # It's a file - extract stream name from first line
    head -1 "thoughts/CURRENT.md" | sed 's/^# //'
else
    echo "NO_ACTIVE"
fi
```

If result is "NO_ACTIVE":
```
No active stream. Run /skill:new-stream to create one.
```

### Step 2: Read stream content

Use the read tool to read `thoughts/streams/{name}.md`

Extract:
- mission (line after "## Mission")
- focus (line after "## Current Focus")
- Get file modification date using bash: `stat -c %Y thoughts/streams/{name}.md` or `stat -f %m thoughts/streams/{name}.md` (macOS)

### Step 3: List available streams

Use bash:
```bash
echo "===STREAMS==="
for f in thoughts/streams/*.md; do
    [ -f "$f" ] && basename "$f" .md
done
```

### Step 4: Display formatted output

Show compact box with stream info:

```
┌─────────────────────────────────────┐
│  Active Stream: {name}              │
│  Last Updated: {date}                 │
│                                     │
│  Mission: {mission}                  │
│  Current Focus: {focus}              │
└─────────────────────────────────────┘

Available streams:
  • {stream1} (current)
  • {stream2}
  • {stream3}
  ...

Use /skill:switch-stream to change
```

## Error handling

- No active stream → "No active stream. Run /skill:new-stream to create one."
- Stream file missing → "Active stream pointer exists but file is missing. Recreate with /skill:new-stream."
